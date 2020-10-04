import AWS from 'aws-sdk';
import chalk from 'chalk';
import { Listr, ListrTask, ListrTaskWrapper } from 'listr2';

import { TrickInterface } from '../types/trick.interface';
import { TrickOptionsInterface } from '../types/trick-options.interface';

import { ElasticacheReplicationGroupState } from '../states/elasticache-replication-group.state';
import { TrickContext } from '../types/trick-context';

export type SnapshotRemoveElasticacheRedisState = ElasticacheReplicationGroupState[];

export class SnapshotRemoveElasticacheRedisTrick
  implements TrickInterface<SnapshotRemoveElasticacheRedisState> {
  static machineName = 'snapshot-remove-elasticache-redis';

  private elcClient: AWS.ElastiCache;

  private rgtClient: AWS.ResourceGroupsTaggingAPI;

  constructor() {
    this.elcClient = new AWS.ElastiCache();
    this.rgtClient = new AWS.ResourceGroupsTaggingAPI();
  }

  getMachineName(): string {
    return SnapshotRemoveElasticacheRedisTrick.machineName;
  }

  async prepareTags(
    context: TrickContext,
    task: ListrTaskWrapper<any, any>,
    options: TrickOptionsInterface,
  ): Promise<void> {
    const resourceTagMappings: AWS.ResourceGroupsTaggingAPI.ResourceTagMappingList = [];

    // TODO Add logic to go through all pages
    task.output = 'fetching page 1...';
    resourceTagMappings.push(
      ...((
        await this.rgtClient
          .getResources({
            ResourcesPerPage: 100,
            ResourceTypeFilters: ['elasticache:cluster'],
            TagFilters: options.tags,
          })
          .promise()
      ).ResourceTagMappingList || []),
    );

    context.resourceTagMappings = resourceTagMappings;

    task.output = 'done';
  }

  async getCurrentState(
    context: TrickContext,
    task: ListrTaskWrapper<any, any>,
    currentState: SnapshotRemoveElasticacheRedisState,
    options: TrickOptionsInterface,
  ): Promise<Listr> {
    const replicationGroups = await this.listReplicationGroups(task);

    const subListr = task.newListr([], {
      concurrent: 10,
      exitOnError: false,
      rendererOptions: {
        collapse: true,
      },
    });

    if (!replicationGroups || replicationGroups.length === 0) {
      task.skip(chalk.dim('no ElastiCache Redis clusters found'));
      return subListr;
    }

    subListr.add(
      replicationGroups.map(
        (replicationGroup): ListrTask => {
          return {
            title:
              replicationGroup.ReplicationGroupId || chalk.italic('<no-id>'),
            task: async (ctx, task) => {
              if (replicationGroup.ReplicationGroupId === undefined) {
                throw new Error(
                  `Unexpected error: ReplicationGroupId is missing for ElastiCache replication group`,
                );
              }

              const replicationGroupState = {
                id: replicationGroup.ReplicationGroupId,
              } as ElasticacheReplicationGroupState;

              const changes = await this.getReplicationGroupState(
                context,
                task,
                replicationGroupState,
                replicationGroup,
              );

              if (changes) {
                currentState.push({ ...replicationGroupState, ...changes });
              }
            },
            options: {
              persistentOutput: true,
            },
          };
        },
      ),
    );

    return subListr;
  }

  async conserve(
    task: ListrTaskWrapper<any, any>,
    currentState: SnapshotRemoveElasticacheRedisState,
    options: TrickOptionsInterface,
  ): Promise<Listr> {
    const subListr = task.newListr([], {
      concurrent: 10,
      exitOnError: false,
      rendererOptions: {
        collapse: true,
      },
    });

    if (currentState && currentState.length > 0) {
      for (const replicationGroup of currentState) {
        subListr.add({
          title: chalk.blue(replicationGroup.id),
          task: (ctx, task) =>
            this.conserveReplicationGroup(task, replicationGroup, options),
          options: {
            persistentOutput: true,
          },
        });
      }
    } else {
      task.skip(chalk.dim(`no ElastiCache Redis clusters found`));
    }

    return subListr;
  }

  async restore(
    task: ListrTaskWrapper<any, any>,
    originalState: SnapshotRemoveElasticacheRedisState,
    options: TrickOptionsInterface,
  ): Promise<Listr> {
    const subListr = task.newListr([], {
      concurrent: 10,
      exitOnError: false,
      rendererOptions: {
        collapse: true,
      },
    });

    if (originalState && originalState.length > 0) {
      for (const replicationGroup of originalState) {
        subListr.add({
          title: chalk.blue(replicationGroup.id),
          task: (ctx, task) =>
            this.restoreReplicationGroup(task, replicationGroup, options),
          options: {
            persistentOutput: true,
          },
        });
      }
    } else {
      task.skip(chalk.dim(`no ElastiCache Redis clusters found`));
    }

    return subListr;
  }

  private async conserveReplicationGroup(
    task: ListrTaskWrapper<any, any>,
    replicationGroupState: ElasticacheReplicationGroupState,
    options: TrickOptionsInterface,
  ): Promise<void> {
    if (replicationGroupState.status !== 'available') {
      task.skip(
        chalk.dim(
          `skipped, current state is not "available" it is "${replicationGroupState.status}" instead`,
        ),
      );
      return;
    }

    if (options.dryRun) {
      task.skip(chalk.dim('skipped, would take a snapshot and delete'));
      return;
    }

    task.output = 'taking a snapshot and deleting replication group...';
    await this.elcClient
      .deleteReplicationGroup({
        ReplicationGroupId: replicationGroupState.id,
        FinalSnapshotIdentifier: replicationGroupState.snapshotName,
      })
      .promise();

    task.output =
      'Waiting for snapshot to be created, and replication group to be deleted...';
    await this.elcClient
      .waitFor('replicationGroupDeleted', {
        ReplicationGroupId: replicationGroupState.id,
        $waiter: {
          delay: 30,
          maxAttempts: 100,
        },
      })
      .promise();

    task.output = `Snapshot ${replicationGroupState.snapshotName} taken and replication group deleted successfully`;
  }

  private async restoreReplicationGroup(
    task: ListrTaskWrapper<any, any>,
    replicationGroupState: ElasticacheReplicationGroupState,
    options: TrickOptionsInterface,
  ): Promise<void> {
    if (!replicationGroupState.snapshotName) {
      throw new Error(`Unexpected error: snapshotName is missing in state`);
    }

    if (!replicationGroupState.createParams) {
      throw new Error(`Unexpected error: createParams is missing in state`);
    }

    if (replicationGroupState.status !== 'available') {
      task.skip(
        chalk.dim(
          `skipped, previous state was not "available" it was "${replicationGroupState.status}" instead`,
        ),
      );
      return;
    }

    if (await this.doesReplicationGroupExist(replicationGroupState)) {
      task.skip(chalk.dim('ElastiCache redis cluster already exists'));
      return;
    }

    if (options.dryRun) {
      task.skip(
        chalk.dim(
          `skipped, would re-create the cluster and remove the snapshot ${replicationGroupState.snapshotName}`,
        ),
      );
      return;
    }

    task.output = `Creating replication group (snapshot: ${replicationGroupState.snapshotName})...`;
    await this.elcClient
      .createReplicationGroup(replicationGroupState.createParams)
      .promise();

    task.output = `Waiting for replication group to be available (snapshot: ${replicationGroupState.snapshotName})...`;
    await this.elcClient
      .waitFor('replicationGroupAvailable', {
        ReplicationGroupId: replicationGroupState.id,
        $waiter: {
          delay: 30,
          maxAttempts: 100,
        },
      })
      .promise();

    task.output = `Deleting snapshot ${replicationGroupState.snapshotName}...`;
    await this.elcClient
      .deleteSnapshot({
        SnapshotName: replicationGroupState.snapshotName,
      })
      .promise();

    task.output = 'restored successfully';
  }

  private async getReplicationGroupState(
    context: TrickContext,
    task: ListrTaskWrapper<any, any>,
    replicationGroupState: ElasticacheReplicationGroupState,
    replicationGroup: AWS.ElastiCache.ReplicationGroup,
  ): Promise<ElasticacheReplicationGroupState | undefined> {
    replicationGroupState.status = 'unknown';

    if (replicationGroup.ARN === undefined) {
      throw new Error(
        `Unexpected error: ARN is missing for ElastiCache replication group`,
      );
    }

    if (replicationGroup.Status === undefined) {
      throw new Error(
        `Unexpected error: Status is missing for ElastiCache replication group`,
      );
    }

    if (
      !replicationGroup.MemberClusters ||
      replicationGroup.MemberClusters.length === 0
    ) {
      throw new Error(
        `Unexpected error: No member clusters for ElastiCache replication group`,
      );
    }

    if (replicationGroup.AuthTokenEnabled) {
      throw new Error(
        `Cannot conserve an AuthToken protected Redis Cluster because on restore token will change`,
      );
    }

    task.output = 'fetching a sample cache cluster...';
    const sampleCacheCluster = await this.describeCacheCluster(
      replicationGroup.MemberClusters[0],
    );

    if (!sampleCacheCluster) {
      throw new Error(`Could not find sample cache cluster`);
    }

    if (!this.isClusterIncluded(context, sampleCacheCluster.ARN as string)) {
      task.skip(`excluded due to tag filters`);
      return;
    }

    task.output = 'preparing re-create params...';
    const snapshotName = SnapshotRemoveElasticacheRedisTrick.generateSnapshotName(
      replicationGroup,
    );
    const nodeGroups = this.generateNodeGroupConfigs(replicationGroup);
    const createParams = await this.buildCreateParams(
      snapshotName,
      replicationGroup,
      nodeGroups,
      sampleCacheCluster,
    );

    replicationGroupState.snapshotName = snapshotName;
    replicationGroupState.status = replicationGroup.Status;
    replicationGroupState.createParams = createParams;

    task.output = 'done';

    return replicationGroupState;
  }

  private generateNodeGroupConfigs(
    replicationGroup: AWS.ElastiCache.ReplicationGroup,
  ) {
    return (
      replicationGroup.NodeGroups?.map(
        n =>
          ({
            NodeGroupId: n.NodeGroupId,
            ReplicaCount: n.NodeGroupMembers?.length,
            Slots: n.Slots,
          } as AWS.ElastiCache.NodeGroupConfiguration),
      ) || []
    );
  }

  private async buildCreateParams(
    snapshotName: string,
    replicationGroup: AWS.ElastiCache.ReplicationGroup,
    nodeGroups: AWS.ElastiCache.NodeGroupConfiguration[],
    sampleCacheCluster: AWS.ElastiCache.CacheCluster,
  ): Promise<AWS.ElastiCache.CreateReplicationGroupMessage> {
    return {
      // Required
      ReplicationGroupId: replicationGroup.ReplicationGroupId,
      ReplicationGroupDescription:
        replicationGroup.Description ||
        `Restored by aws-cost-saver from snapshot: ${snapshotName}`,
      SnapshotName: snapshotName,

      // Replication Group Configs
      AtRestEncryptionEnabled: replicationGroup.AtRestEncryptionEnabled,
      TransitEncryptionEnabled: replicationGroup.TransitEncryptionEnabled,
      NumCacheClusters:
        nodeGroups.length > 1
          ? undefined
          : replicationGroup.MemberClusters?.length || 1,
      NumNodeGroups: nodeGroups.length > 1 ? nodeGroups.length : undefined,
      MultiAZEnabled:
        replicationGroup.MultiAZ !== undefined &&
        replicationGroup.MultiAZ === 'enabled',
      NodeGroupConfiguration: nodeGroups.length > 1 ? nodeGroups : undefined,
      GlobalReplicationGroupId:
        replicationGroup.GlobalReplicationGroupInfo?.GlobalReplicationGroupId,
      KmsKeyId: replicationGroup.KmsKeyId,
      AutomaticFailoverEnabled:
        replicationGroup.AutomaticFailover !== undefined &&
        ['enabled', 'enabling'].includes(replicationGroup.AutomaticFailover),
      Port:
        sampleCacheCluster.CacheNodes &&
        sampleCacheCluster.CacheNodes[0]?.Endpoint?.Port,
      Tags: await this.getTags(sampleCacheCluster.ARN as string),

      // Cache Clusters Configs
      PreferredCacheClusterAZs:
        nodeGroups.length > 1
          ? undefined
          : sampleCacheCluster.PreferredAvailabilityZone
          ? [sampleCacheCluster.PreferredAvailabilityZone]
          : undefined,
      SecurityGroupIds: sampleCacheCluster.SecurityGroups?.map(
        s => s.SecurityGroupId as string,
      ),
      CacheSecurityGroupNames: sampleCacheCluster.CacheSecurityGroups?.map(
        c => c.CacheSecurityGroupName || '',
      ),

      // Shared Cache Cluster Configs
      AutoMinorVersionUpgrade: sampleCacheCluster.AutoMinorVersionUpgrade,
      CacheNodeType: sampleCacheCluster.CacheNodeType,
      SnapshotRetentionLimit: sampleCacheCluster.SnapshotRetentionLimit,
      Engine: sampleCacheCluster.Engine,
      EngineVersion: sampleCacheCluster.EngineVersion,
      CacheParameterGroupName:
        sampleCacheCluster.CacheParameterGroup?.CacheParameterGroupName,
      CacheSubnetGroupName: sampleCacheCluster.CacheSubnetGroupName,
      NotificationTopicArn:
        sampleCacheCluster.NotificationConfiguration?.TopicArn,
      SnapshotWindow: sampleCacheCluster.SnapshotWindow,
      PreferredMaintenanceWindow: sampleCacheCluster.PreferredMaintenanceWindow,
    } as AWS.ElastiCache.CreateReplicationGroupMessage;
  }

  private async doesReplicationGroupExist(
    replicationGroupState: ElasticacheReplicationGroupState,
  ) {
    const result = await this.elcClient
      .describeReplicationGroups({
        ReplicationGroupId: replicationGroupState.id,
      })
      .promise();

    return Boolean(
      result.ReplicationGroups && result.ReplicationGroups.length > 0,
    );
  }

  private async listReplicationGroups(
    task: ListrTaskWrapper<any, any>,
  ): Promise<AWS.ElastiCache.ReplicationGroupList> {
    const replicationGroups: AWS.ElastiCache.ReplicationGroupList = [];

    // TODO Add logic to go through all pages
    task.output = 'fetching page 1...';
    replicationGroups.push(
      ...((
        await this.elcClient
          .describeReplicationGroups({ MaxRecords: 100 })
          .promise()
      ).ReplicationGroups as AWS.ElastiCache.ReplicationGroupList),
    );

    task.output = 'done';
    return replicationGroups;
  }

  private async describeCacheCluster(
    cacheClusterId: string,
  ): Promise<AWS.ElastiCache.CacheCluster | undefined> {
    return ((
      await this.elcClient
        .describeCacheClusters({
          CacheClusterId: cacheClusterId,
          ShowCacheNodeInfo: true,
        })
        .promise()
    ).CacheClusters as AWS.ElastiCache.CacheClusterList).pop();
  }

  private async getTags(arn: string) {
    return (
      await this.elcClient
        .listTagsForResource({
          ResourceName: arn,
        })
        .promise()
    ).TagList as AWS.ElastiCache.TagList;
  }

  private isClusterIncluded(
    context: TrickContext,
    clusterArn: string,
  ): boolean {
    return Boolean(
      context.resourceTagMappings?.find(rm => rm.ResourceARN === clusterArn),
    );
  }

  private static generateSnapshotName(
    replicationGroup: AWS.ElastiCache.ReplicationGroup,
  ) {
    const now = new Date();
    return `${
      replicationGroup.ReplicationGroupId
    }-${now.getFullYear()}${now.getMonth()}${now.getDay()}${now.getHours()}${now.getMinutes()}`;
  }
}
