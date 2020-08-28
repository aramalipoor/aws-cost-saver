import _ from 'lodash';
import AWS from 'aws-sdk';
import chalk from 'chalk';
import Listr, { ListrTask, ListrTaskWrapper } from 'listr';

import { TrickInterface } from '../interfaces/trick.interface';
import { TrickOptionsInterface } from '../interfaces/trick-options.interface';

import { EcsClusterState } from '../states/ecs-cluster.state';
import { EcsServiceState } from '../states/ecs-service.state';

export type StopFargateEcsServicesState = EcsClusterState[];

export class StopFargateEcsServicesTrick
  implements TrickInterface<StopFargateEcsServicesState> {
  private ecsClient: AWS.ECS;

  static machineName = 'stop-fargate-ecs-services';

  private aasClient: AWS.ApplicationAutoScaling;

  constructor() {
    this.ecsClient = new AWS.ECS();
    this.aasClient = new AWS.ApplicationAutoScaling();
  }

  getMachineName(): string {
    return StopFargateEcsServicesTrick.machineName;
  }

  getConserveTitle(): string {
    return 'Stop Fargate ECS Services';
  }

  getRestoreTitle(): string {
    return 'Restore Fargate ECS Services';
  }

  async getCurrentState(
    task: ListrTaskWrapper,
    currentState: StopFargateEcsServicesState,
    options: TrickOptionsInterface,
  ): Promise<Listr> {
    const clustersArn = await this.listClusters(task);

    if (!clustersArn || clustersArn.length === 0) {
      task.skip('No clusters found');
      return;
    }

    const subListr = new Listr({
      concurrent: 3,
      exitOnError: false,
      // @ts-ignore
      collapse: false,
    });

    subListr.add(
      clustersArn.map(
        (clusterArn): ListrTask => {
          const clusterState: EcsClusterState = {
            arn: clusterArn,
            services: [],
          };
          currentState.push(clusterState);
          return {
            title: clusterArn,
            task: async (ctx, task) => this.getClusterState(task, clusterState),
          };
        },
      ),
    );

    return subListr;
  }

  async conserve(
    task: ListrTaskWrapper,
    currentState: StopFargateEcsServicesState,
    options: TrickOptionsInterface,
  ): Promise<Listr> {
    const subListr = new Listr({
      concurrent: 3,
      exitOnError: false,
      // @ts-ignore
      collapse: false,
    });

    for (const cluster of currentState) {
      for (const service of cluster.services) {
        subListr.add({
          title: `${chalk.blueBright(
            StopFargateEcsServicesTrick.getEcsServiceResourceId(
              cluster.arn,
              service.arn,
            ),
          )}`,
          task: () =>
            new Listr(
              [
                {
                  title: 'Desired count',
                  task: (ctx, task) =>
                    this.conserveDesiredCount(task, cluster, service, options),
                },
                {
                  title: 'Auto scaling',
                  task: (ctx, task) =>
                    this.conserveScalableTargets(
                      task,
                      cluster,
                      service,
                      options,
                    ),
                },
              ],
              {
                exitOnError: false,
                concurrent: true,
                // @ts-ignore
                collapse: false,
              },
            ),
        });
      }
    }

    return subListr;
  }

  async restore(
    task: ListrTaskWrapper,
    originalState: StopFargateEcsServicesState,
    options: TrickOptionsInterface,
  ): Promise<Listr> {
    const subListr = new Listr({
      concurrent: 3,
      exitOnError: false,
      // @ts-ignore
      collapse: false,
    });

    for (const cluster of originalState) {
      for (const service of cluster.services) {
        subListr.add({
          title: `${chalk.blueBright(
            StopFargateEcsServicesTrick.getEcsServiceResourceId(
              cluster.arn,
              service.arn,
            ),
          )}`,
          task: () =>
            new Listr(
              [
                {
                  title: 'Desired count',
                  task: (ctx, task) =>
                    this.restoreDesiredCount(task, cluster, service, options),
                },
                {
                  title: 'Auto scaling',
                  task: (ctx, task) =>
                    this.restoreScalableTargets(
                      task,
                      cluster,
                      service,
                      options,
                    ),
                },
              ],
              {
                exitOnError: false,
                concurrent: true,
                // @ts-ignore
                collapse: false,
              },
            ),
        });
      }
    }

    return subListr;
  }

  private async getClusterState(
    task: ListrTaskWrapper,
    clusterState: EcsClusterState,
  ) {
    const services = await this.describeAllServices(task, clusterState.arn);

    if (!services || services.length === 0) {
      task.skip('No services found');
      return;
    }

    const subListr = new Listr({
      concurrent: 10,
      exitOnError: false,
      // @ts-ignore
      collapse: false,
    });

    subListr.add(
      services.map(
        (service): ListrTask => {
          if (!service.serviceArn) {
            throw new Error(
              `Unexpected error: Fargate ECS Service does not have ARN`,
            );
          }

          const serviceState: EcsServiceState = {
            arn: service.serviceArn,
            desired: service.desiredCount || 0,
            scalableTargets: [],
          };

          clusterState.services.push(serviceState);

          return {
            title: service.serviceArn,
            task: async (ctx, task) =>
              this.getServiceState(task, serviceState, clusterState),
          };
        },
      ),
    );

    return subListr;
  }

  private async getServiceState(
    task: ListrTaskWrapper,
    serviceState: EcsServiceState,
    clusterState: EcsClusterState,
  ): Promise<void> {
    task.output = 'Fetching scalable targets...';
    const scalableTargets = await this.describeAllScalableTargets(
      clusterState.arn,
      serviceState.arn,
    );

    serviceState.scalableTargets.push(
      ...scalableTargets.map(st => ({
        namespace: 'ecs',
        resourceId: st.ResourceId,
        scalableDimension: st.ScalableDimension,
        min: st.MinCapacity,
        max: st.MaxCapacity,
      })),
    );
  }

  private async listClusters(task: ListrTaskWrapper): Promise<string[]> {
    const clustersArn: string[] = [];

    // TODO Add logic to go through all pages
    task.output = 'Fetching page 1...';
    clustersArn.push(
      ...((await this.ecsClient.listClusters({ maxResults: 100 }).promise())
        .clusterArns || []),
    );

    return clustersArn;
  }

  private async listServices(task: ListrTaskWrapper, clusterArn: string) {
    const servicesArn: string[] = [];

    // TODO Add logic to go through all pages
    task.output = 'Fetching page 1...';
    servicesArn.push(
      ...((
        await this.ecsClient
          .listServices({
            cluster: clusterArn,
            launchType: 'FARGATE',
            maxResults: 100,
          })
          .promise()
      ).serviceArns || []),
    );

    return servicesArn;
  }

  private async describeAllServices(
    task: ListrTaskWrapper,
    clusterArn: string,
  ): Promise<AWS.ECS.Service[]> {
    task.output = `Fetching all services ARNs...`;
    const servicesArn = await this.listServices(task, clusterArn);
    const chunks = _.chunk<string>(servicesArn, 10);
    const result: AWS.ECS.Service[] = [];

    for (let i = 0, c = chunks.length; i < c; i++) {
      task.output = `Describing services, page ${i + 1} of ${c}...`;
      const response = await this.ecsClient
        .describeServices({ services: chunks[i], cluster: clusterArn })
        .promise();

      result.push(...(response.services || []));
    }

    return result;
  }

  private async describeAllScalableTargets(
    clusterArn: string,
    serviceArn: string,
  ): Promise<AWS.ApplicationAutoScaling.ScalableTarget[]> {
    const result = await this.aasClient
      .describeScalableTargets({
        ServiceNamespace: 'ecs',
        ResourceIds: [
          StopFargateEcsServicesTrick.getEcsServiceResourceId(
            clusterArn,
            serviceArn,
          ),
        ],
        ScalableDimension: 'ecs:service:DesiredCount',
      })
      .promise();

    return result.ScalableTargets || [];
  }

  private async conserveDesiredCount(
    task: ListrTaskWrapper,
    clusterState: EcsClusterState,
    serviceState: EcsServiceState,
    options: TrickOptionsInterface,
  ): Promise<void> {
    if (serviceState.desired < 1) {
      task.skip(`Skipped, desired count is already zero`);
      return;
    }

    if (options.dryRun) {
      task.skip('Skipped, would set tasks desired count to 0');
      return;
    }

    task.output = `Updating desired count to zero...`;
    await this.ecsClient
      .updateService({
        cluster: clusterState.arn,
        service: serviceState.arn,
        desiredCount: 0,
      })
      .promise();

    task.output = `Waiting for service to scale down to zero...`;
    await this.ecsClient
      .waitFor('servicesStable', {
        cluster: clusterState.arn,
        services: [serviceState.arn],
      })
      .promise();

    task.output = 'Set desired count to zero';
  }

  private async conserveScalableTargets(
    task: ListrTaskWrapper,
    clusterState: EcsClusterState,
    serviceState: EcsServiceState,
    options: TrickOptionsInterface,
  ): Promise<void> {
    if (
      !serviceState.scalableTargets ||
      serviceState.scalableTargets.length === 0
    ) {
      task.skip('No scalable targets defined');
      return;
    }

    for (const scalableTarget of serviceState.scalableTargets) {
      const resourceId = StopFargateEcsServicesTrick.getEcsServiceResourceId(
        clusterState.arn,
        serviceState.arn,
      );

      if (options.dryRun) {
        task.skip('Skipped, would set scalable target min = 0 and max = 0');
      } else {
        await this.aasClient
          .registerScalableTarget({
            ServiceNamespace: scalableTarget.namespace,
            ResourceId: resourceId,
            ScalableDimension: scalableTarget.scalableDimension,
            MinCapacity: 0,
            MaxCapacity: 0,
          })
          .promise();
      }
    }
  }

  private async restoreDesiredCount(
    task: ListrTaskWrapper,
    clusterState: EcsClusterState,
    serviceState: EcsServiceState,
    options: TrickOptionsInterface,
  ): Promise<void> {
    if (serviceState.desired < 1) {
      task.skip(`Skipped, desired count was previously zero`);
      return;
    }

    if (options.dryRun) {
      task.skip(
        `Skipped, would update desired count to ${serviceState.desired}`,
      );
      return;
    }

    task.output = `Updating desired count to ${serviceState.desired}...`;
    await this.ecsClient
      .updateService({
        cluster: clusterState.arn,
        service: serviceState.arn,
        desiredCount: serviceState.desired,
      })
      .promise();

    task.output = `Waiting for service to reach ${serviceState.desired} desired tasks...`;
    await this.ecsClient
      .waitFor('servicesStable', {
        cluster: clusterState.arn,
        services: [serviceState.arn],
      })
      .promise();

    task.output = `Restored desired count to ${serviceState.desired}`;
  }

  private async restoreScalableTargets(
    task: ListrTaskWrapper,
    clusterState: EcsClusterState,
    serviceState: EcsServiceState,
    options: TrickOptionsInterface,
  ): Promise<void> {
    if (
      !serviceState.scalableTargets ||
      serviceState.scalableTargets.length === 0
    ) {
      task.skip('No scalable targets defined');
      return;
    }

    for (const scalableTarget of serviceState.scalableTargets) {
      const resourceId = StopFargateEcsServicesTrick.getEcsServiceResourceId(
        clusterState.arn,
        serviceState.arn,
      );
      if (options.dryRun) {
        task.skip(
          `Skipped, would set scalable target min = ${scalableTarget.min} and max = ${scalableTarget.max}`,
        );
      } else {
        await this.aasClient
          .registerScalableTarget({
            ServiceNamespace: scalableTarget.namespace,
            ResourceId: resourceId,
            ScalableDimension: scalableTarget.scalableDimension,
            MinCapacity: scalableTarget.min,
            MaxCapacity: scalableTarget.max,
          })
          .promise();
      }
    }
  }

  private static getEcsServiceResourceId(
    clusterArn: string,
    serviceArn: string,
  ) {
    const clusterName = clusterArn
      .toString()
      .split('/')
      .pop();
    const serviceName = serviceArn
      .toString()
      .split('/')
      .pop();

    return `service/${clusterName}/${serviceName}`;
  }
}
