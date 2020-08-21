import _ from 'lodash';
import AWS from 'aws-sdk';
import Listr, { ListrTaskWrapper } from 'listr';
import chalk from 'chalk';

import { TrickInterface } from '../interfaces/trick.interface';
import { EcsClusterState } from '../states/ecs-cluster.state';
import { EcsServiceState } from '../states/ecs-service.state';

export type StopFargateEcsServicesState = EcsClusterState[];

export class StopFargateEcsServicesTrick
  implements TrickInterface<StopFargateEcsServicesState> {
  private ecsClient: AWS.ECS;

  private aasClient: AWS.ApplicationAutoScaling;

  constructor() {
    this.ecsClient = new AWS.ECS();
    this.aasClient = new AWS.ApplicationAutoScaling();
  }

  getMachineName(): string {
    return 'stop-fargate-ecs-services';
  }

  getDisplayName(): string {
    return 'Stop Fargate ECS Services';
  }

  async conserve(
    subListr: Listr,
    dryRun: boolean,
  ): Promise<StopFargateEcsServicesState> {
    const clustersArn = await this.listClusters();
    const currentState = await this.getCurrentState(clustersArn);

    for (const cluster of currentState) {
      for (const service of cluster.services) {
        if (!service.arn.includes('frontend')) continue;
        subListr.add({
          title: `${chalk.blueBright(
            this.getEcsServiceResourceId(cluster.arn, service.arn),
          )}`,
          task: () =>
            new Listr(
              [
                {
                  title: 'Zero desired count',
                  task: (ctx, task) =>
                    this.conserveService(task, dryRun, cluster, service),
                },
                {
                  title: 'Disable auto scaling',
                  task: (ctx, task) =>
                    this.conserveScalableTargets(
                      task,
                      dryRun,
                      cluster,
                      service,
                    ),
                },
              ],
              {
                concurrent: true,
                // eslint-disable-next-line @typescript-eslint/ban-ts-ignore
                // @ts-ignore
                collapse: false,
              },
            ),
        });
      }
    }

    return currentState;
  }

  async restore(
    subListr: Listr,
    dryRun: boolean,
    originalState: StopFargateEcsServicesState,
  ): Promise<void> {
    for (const cluster of originalState) {
      for (const service of cluster.services) {
        if (!service.arn.includes('frontend')) continue;
        subListr.add({
          title: `${chalk.blueBright(
            this.getEcsServiceResourceId(cluster.arn, service.arn),
          )}`,
          task: () =>
            new Listr(
              [
                {
                  title: 'ECS Tasks',
                  task: (ctx, task) =>
                    this.restoreService(task, dryRun, cluster, service),
                },
                {
                  title: 'Scalable Targets',
                  task: (ctx, task) =>
                    this.restoreScalableTargets(task, dryRun, cluster, service),
                },
              ],
              {
                concurrent: true,
                // eslint-disable-next-line @typescript-eslint/ban-ts-ignore
                // @ts-ignore
                collapse: true,
              },
            ),
        });
      }
    }
  }

  private async conserveService(
    task: ListrTaskWrapper,
    dryRun: boolean,
    clusterState: EcsClusterState,
    serviceState: EcsServiceState,
  ): Promise<void> {
    if (dryRun) {
      task.skip('Skipped due to dry-run');
    } else {
      await this.ecsClient
        .updateService({
          cluster: clusterState.arn,
          service: serviceState.arn,
          desiredCount: 0,
        })
        .promise();
      task.output = 'Set desired count to 0';
    }
  }

  private async conserveScalableTargets(
    task: ListrTaskWrapper,
    dryRun: boolean,
    clusterState: EcsClusterState,
    serviceState: EcsServiceState,
  ): Promise<void> {
    if (
      !serviceState.scalableTargets ||
      serviceState.scalableTargets.length === 0
    ) {
      task.skip('No scalable targets defined');
      return;
    }

    if (dryRun) {
      task.skip('Skipped due to dry-run');
    } else {
      for (const scalableTarget of serviceState.scalableTargets) {
        const resourceId = this.getEcsServiceResourceId(
          clusterState.arn,
          serviceState.arn,
        );
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

  private async restoreService(
    task: ListrTaskWrapper,
    dryRun: boolean,
    clusterState: EcsClusterState,
    serviceState: EcsServiceState,
  ): Promise<void> {
    if (dryRun) {
      task.skip(`Skipped due to dry-run`);
    } else {
      await this.ecsClient
        .updateService({
          cluster: clusterState.arn,
          service: serviceState.arn,
          desiredCount: serviceState.desired,
        })
        .promise();
      task.output = `Restored desired count to ${serviceState.desired}`;
    }
  }

  private async restoreScalableTargets(
    task: ListrTaskWrapper,
    dryRun: boolean,
    clusterState: EcsClusterState,
    serviceState: EcsServiceState,
  ): Promise<void> {
    if (
      !serviceState.scalableTargets ||
      serviceState.scalableTargets.length === 0
    ) {
      task.skip('No scalable targets defined');
      return;
    }

    for (const scalableTarget of serviceState.scalableTargets) {
      const resourceId = this.getEcsServiceResourceId(
        clusterState.arn,
        serviceState.arn,
      );
      if (dryRun) {
        task.skip('Skipped due to dry-run');
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

  private async getCurrentState(clustersArn: string[]) {
    return Promise.all(
      clustersArn.map(
        async (clusterArn): Promise<EcsClusterState> => {
          const services = await this.describeAllServices(clusterArn);
          return {
            arn: clusterArn,
            services: await Promise.all(
              services.map(
                async (service: AWS.ECS.Service): Promise<EcsServiceState> => {
                  if (service.serviceArn === undefined) {
                    throw new Error(
                      `Unexpected error: serviceArn is missing for ECS service`,
                    );
                  }
                  if (service.desiredCount === undefined) {
                    throw new Error(
                      `Unexpected error: desiredCount is missing for ECS service`,
                    );
                  }

                  const scalableTargets = await this.describeAllScalableTargets(
                    service,
                  );
                  return {
                    arn: service.serviceArn,
                    desired: service.desiredCount,
                    scalableTargets: scalableTargets.map(st => ({
                      namespace: 'ecs',
                      resourceId: st.ResourceId,
                      scalableDimension: st.ScalableDimension,
                      min: st.MinCapacity,
                      max: st.MaxCapacity,
                    })),
                  };
                },
              ),
            ),
          };
        },
      ),
    );
  }

  private async listServices(clusterArn: string) {
    return (
      (
        await this.ecsClient
          .listServices({
            cluster: clusterArn,
            launchType: 'FARGATE',
          })
          .promise()
      ).serviceArns || []
    );
  }

  private async listClusters(): Promise<string[]> {
    return (await this.ecsClient.listClusters({}).promise()).clusterArns || [];
  }

  private async describeAllServices(
    clusterArn: string,
  ): Promise<AWS.ECS.Service[]> {
    const servicesArn = await this.listServices(clusterArn);
    const chunks = _.chunk<string>(servicesArn, 10);
    const result = [];

    for (const services of chunks) {
      // eslint-disable-next-line no-await-in-loop
      const response = await this.ecsClient
        .describeServices({ services, cluster: clusterArn })
        .promise();

      result.push(...(response.services || []));
    }

    return result;
  }

  private async describeAllScalableTargets(
    service: AWS.ECS.Service,
  ): Promise<AWS.ApplicationAutoScaling.ScalableTarget[]> {
    if (!service.clusterArn) {
      throw new Error(
        `Unexpected missing clusterArn for ECS service: ${service}`,
      );
    }
    if (!service.serviceArn) {
      throw new Error(
        `Unexpected missing serviceArn for ECS service: ${service}`,
      );
    }

    const result = await this.aasClient
      .describeScalableTargets({
        ServiceNamespace: 'ecs',
        ResourceIds: [
          this.getEcsServiceResourceId(service.clusterArn, service.serviceArn),
        ],
        ScalableDimension: 'ecs:service:DesiredCount',
      })
      .promise();

    return result.ScalableTargets || [];
  }

  private getEcsServiceResourceId(clusterArn: string, serviceArn: string) {
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
