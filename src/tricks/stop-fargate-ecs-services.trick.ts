import _ from 'lodash';
import AWS from 'aws-sdk';
import chalk from 'chalk';
import { Listr, ListrTask, ListrTaskWrapper } from 'listr2';

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

  async getCurrentState(
    task: ListrTaskWrapper<any, any>,
    currentState: StopFargateEcsServicesState,
    options: TrickOptionsInterface,
  ): Promise<Listr> {
    const clustersArn = await this.listClusters(task);

    const subListr = task.newListr([], {
      concurrent: 3,
      exitOnError: false,
      rendererOptions: {
        collapse: true,
      },
    });

    if (!clustersArn || clustersArn.length === 0) {
      task.skip(chalk.dim('No clusters found'));
      return subListr;
    }

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
    task: ListrTaskWrapper<any, any>,
    currentState: StopFargateEcsServicesState,
    options: TrickOptionsInterface,
  ): Promise<Listr> {
    const subListr = task.newListr([], {
      concurrent: 3,
      exitOnError: false,
      rendererOptions: {
        collapse: false,
      },
    });

    for (const cluster of currentState) {
      for (const service of cluster.services) {
        subListr.add({
          title: `${chalk.greenBright(
            StopFargateEcsServicesTrick.getEcsServiceResourceId(
              cluster.arn,
              service.arn,
            ),
          )}`,
          task: (ctx, task) =>
            task.newListr(
              [
                {
                  title: 'desired count',
                  task: (ctx, task) =>
                    this.conserveDesiredCount(task, cluster, service, options),
                  options: {
                    persistentOutput: true,
                  },
                },
                {
                  title: 'auto scaling',
                  task: (ctx, task) =>
                    this.conserveScalableTargets(
                      task,
                      cluster,
                      service,
                      options,
                    ),
                  options: {
                    persistentOutput: true,
                  },
                },
              ],
              {
                exitOnError: false,
                concurrent: true,
                rendererOptions: {
                  collapse: false,
                },
              },
            ),
        });
      }
    }

    return subListr;
  }

  async restore(
    task: ListrTaskWrapper<any, any>,
    originalState: StopFargateEcsServicesState,
    options: TrickOptionsInterface,
  ): Promise<Listr> {
    const subListr = task.newListr([], {
      concurrent: 3,
      exitOnError: false,
      rendererOptions: {
        collapse: false,
      },
    });

    for (const cluster of originalState) {
      for (const service of cluster.services) {
        subListr.add({
          title: `${chalk.greenBright(
            StopFargateEcsServicesTrick.getEcsServiceResourceId(
              cluster.arn,
              service.arn,
            ),
          )}`,
          task: (ctx, task) =>
            task.newListr(
              [
                {
                  title: 'desired count',
                  task: (ctx, task) =>
                    this.restoreDesiredCount(task, cluster, service, options),
                  options: {
                    persistentOutput: true,
                  },
                },
                {
                  title: 'auto scaling',
                  task: (ctx, task) =>
                    this.restoreScalableTargets(
                      task,
                      cluster,
                      service,
                      options,
                    ),
                  options: {
                    persistentOutput: true,
                  },
                },
              ],
              {
                exitOnError: false,
                concurrent: true,
                rendererOptions: {
                  collapse: false,
                },
              },
            ),
        });
      }
    }

    return subListr;
  }

  private async getClusterState(
    task: ListrTaskWrapper<any, any>,
    clusterState: EcsClusterState,
  ) {
    const services = await this.describeAllServices(task, clusterState.arn);

    if (!services || services.length === 0) {
      task.skip(chalk.dim('No services found'));
      return;
    }

    const subListr = task.newListr([], {
      concurrent: 10,
      exitOnError: false,
      rendererOptions: {
        collapse: false,
      },
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
            desired: service.desiredCount as number,
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

    task.output = 'done';
    return subListr;
  }

  private async getServiceState(
    task: ListrTaskWrapper<any, any>,
    serviceState: EcsServiceState,
    clusterState: EcsClusterState,
  ): Promise<void> {
    task.output = 'fetching scalable targets...';
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

    task.output = 'done';
  }

  private async listClusters(
    task: ListrTaskWrapper<any, any>,
  ): Promise<string[]> {
    const clustersArn: string[] = [];

    // TODO Add logic to go through all pages
    task.output = 'fetching page 1...';
    clustersArn.push(
      ...((await this.ecsClient.listClusters({ maxResults: 100 }).promise())
        .clusterArns as AWS.ECS.StringList),
    );

    task.output = 'done';
    return clustersArn;
  }

  private async listServices(
    task: ListrTaskWrapper<any, any>,
    clusterArn: string,
  ) {
    const servicesArn: string[] = [];

    // TODO Add logic to go through all pages
    task.output = 'fetching page 1...';
    servicesArn.push(
      ...((
        await this.ecsClient
          .listServices({
            cluster: clusterArn,
            launchType: 'FARGATE',
            maxResults: 100,
          })
          .promise()
      ).serviceArns as AWS.ECS.StringList),
    );

    task.output = 'done';
    return servicesArn;
  }

  private async describeAllServices(
    task: ListrTaskWrapper<any, any>,
    clusterArn: string,
  ): Promise<AWS.ECS.Service[]> {
    task.output = `Fetching all services ARNs...`;
    const servicesArn = await this.listServices(task, clusterArn);
    const chunks = _.chunk<string>(servicesArn, 10);
    const result: AWS.ECS.Services = [];

    for (let i = 0, c = chunks.length; i < c; i++) {
      task.output = `Describing services, page ${i + 1} of ${c}...`;
      const response = await this.ecsClient
        .describeServices({ services: chunks[i], cluster: clusterArn })
        .promise();

      result.push(...(response.services as AWS.ECS.Services));
    }

    task.output = 'done';
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
    task: ListrTaskWrapper<any, any>,
    clusterState: EcsClusterState,
    serviceState: EcsServiceState,
    options: TrickOptionsInterface,
  ): Promise<void> {
    if (serviceState.desired < 1) {
      task.skip(chalk.dim(`skipped, desired count is already zero`));
      return;
    }

    if (options.dryRun) {
      task.skip(chalk.dim('skipped, would set tasks desired count to 0'));
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

    task.output = 'set desired count to zero';
  }

  private async conserveScalableTargets(
    task: ListrTaskWrapper<any, any>,
    clusterState: EcsClusterState,
    serviceState: EcsServiceState,
    options: TrickOptionsInterface,
  ): Promise<void> {
    if (
      !serviceState.scalableTargets ||
      serviceState.scalableTargets.length === 0
    ) {
      task.skip(chalk.dim('no scalable targets defined'));
      return;
    }

    for (const scalableTarget of serviceState.scalableTargets) {
      const resourceId = StopFargateEcsServicesTrick.getEcsServiceResourceId(
        clusterState.arn,
        serviceState.arn,
      );

      if (options.dryRun) {
        task.skip(
          chalk.dim('skipped, would set scalable target min = 0 and max = 0'),
        );
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

    task.output = 'set scalable target min = 0 and max = 0';
  }

  private async restoreDesiredCount(
    task: ListrTaskWrapper<any, any>,
    clusterState: EcsClusterState,
    serviceState: EcsServiceState,
    options: TrickOptionsInterface,
  ): Promise<void> {
    if (serviceState.desired < 1) {
      task.skip(chalk.dim(`skipped, desired count was previously zero`));
      return;
    }

    if (options.dryRun) {
      task.skip(
        chalk.dim(
          `skipped, would update desired count to ${serviceState.desired}`,
        ),
      );
      return;
    }

    task.output = `updating desired count to ${serviceState.desired}...`;
    await this.ecsClient
      .updateService({
        cluster: clusterState.arn,
        service: serviceState.arn,
        desiredCount: serviceState.desired,
      })
      .promise();

    task.output = `waiting for service to reach ${serviceState.desired} desired tasks...`;
    await this.ecsClient
      .waitFor('servicesStable', {
        cluster: clusterState.arn,
        services: [serviceState.arn],
      })
      .promise();

    task.output = `restored desired count to ${serviceState.desired}`;
  }

  private async restoreScalableTargets(
    task: ListrTaskWrapper<any, any>,
    clusterState: EcsClusterState,
    serviceState: EcsServiceState,
    options: TrickOptionsInterface,
  ): Promise<void> {
    if (
      !serviceState.scalableTargets ||
      serviceState.scalableTargets.length === 0
    ) {
      task.skip(chalk.dim('no scalable targets defined'));
      return;
    }

    for (const scalableTarget of serviceState.scalableTargets) {
      const resourceId = StopFargateEcsServicesTrick.getEcsServiceResourceId(
        clusterState.arn,
        serviceState.arn,
      );
      if (options.dryRun) {
        task.skip(
          chalk.dim(
            `skipped, would set scalable target min = ${scalableTarget.min} and max = ${scalableTarget.max}`,
          ),
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

    task.output = `restored scalable targets`;
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
