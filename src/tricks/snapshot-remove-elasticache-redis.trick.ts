import AWS from 'aws-sdk';
import chalk from 'chalk';
import Listr, { ListrOptions, ListrTask, ListrTaskWrapper } from 'listr';

import { TrickInterface } from '../interfaces/trick.interface';
import { TrickOptionsInterface } from '../interfaces/trick-options.interface';

import { ElasticacheReplicationGroupState } from '../states/elasticache-replication-group.state';

export type SnapshotRemoveElasticacheRedisState = ElasticacheReplicationGroupState[];

export class SnapshotRemoveElasticacheRedisTrick
  implements TrickInterface<SnapshotRemoveElasticacheRedisState> {
  private elcClient: AWS.ElastiCache;

  static machineName = 'snapshot-remove-elasticache-redis';

  constructor() {
    this.elcClient = new AWS.ElastiCache();
  }

  getMachineName(): string {
    return SnapshotRemoveElasticacheRedisTrick.machineName;
  }

  getConserveTitle(): string {
    return 'Snapshot and Remove ElastiCache Redis Clusters';
  }

  getRestoreTitle(): string {
    return 'Recreate ElastiCache Redis Clusters from Snapshot';
  }

  async getCurrentState(
    task: ListrTaskWrapper,
    currentState: SnapshotRemoveElasticacheRedisState,
    options: TrickOptionsInterface,
  ): Promise<Listr> {
    const replicationGroups = await this.listReplicationGroups(task);

    const subListr = new Listr({
      concurrent: 10,
      exitOnError: false,
      collapse: false,
    } as ListrOptions);

    if (!replicationGroups || replicationGroups.length === 0) {
      task.skip('No ElastiCache Redis clusters found');
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

              currentState.push(replicationGroupState);

              return this.getReplicationGroupState(
                task,
                replicationGroupState,
                replicationGroup,
              );
            },
          };
        },
      ),
    );

    return subListr;
  }

  async conserve(
    task: ListrTaskWrapper,
    currentState: SnapshotRemoveElasticacheRedisState,
    options: TrickOptionsInterface,
  ): Promise<Listr> {
    const subListr = new Listr({
      concurrent: 10,
      exitOnError: false,
      collapse: false,
    } as ListrOptions);

    if (currentState && currentState.length > 0) {
      for (const replicationGroup of currentState) {
        subListr.add({
          title: chalk.blueBright(replicationGroup.id),
          task: (ctx, task) =>
            this.conserveReplicationGroup(task, replicationGroup, options),
        });
      }
    } else {
      task.skip(`No ElastiCache Redis clusters found`);
    }

    return subListr;
  }

  async restore(
    task: ListrTaskWrapper,
    originalState: SnapshotRemoveElasticacheRedisState,
    options: TrickOptionsInterface,
  ): Promise<Listr> {
    const subListr = new Listr({
      concurrent: 10,
      exitOnError: false,
      collapse: false,
    } as ListrOptions);

    if (originalState && originalState.length > 0) {
      for (const replicationGroup of originalState) {
        subListr.add({
          title: chalk.blueBright(replicationGroup.id),
          task: (ctx, task) =>
            this.restoreReplicationGroup(task, replicationGroup, options),
        });
      }
    } else {
      task.skip(`No ElastiCache Redis clusters found`);
    }

    return subListr;
  }

  private async conserveReplicationGroup(
    task: ListrTaskWrapper,
    replicationGroupState: ElasticacheReplicationGroupState,
    options: TrickOptionsInterface,
  ): Promise<void> {
    if (replicationGroupState.status !== 'available') {
      task.skip(
        `Skipped, current state is not "available" it is "${replicationGroupState.status}" instead`,
      );
      return;
    }

    if (options.dryRun) {
      task.skip('Skipped, would take a snapshot and delete');
      return;
    }

    task.output = 'Taking a snapshot and deleting replication group...';
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
    task: ListrTaskWrapper,
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
        `Skipped, previous state was not "available" it was "${replicationGroupState.status}" instead`,
      );
      return;
    }

    if (await this.doesReplicationGroupExist(replicationGroupState)) {
      task.skip('ElastiCache redis cluster already exists');
      return;
    }

    if (options.dryRun) {
      task.skip(
        `Skipped, would re-create the cluster and remove the snapshot ${replicationGroupState.snapshotName}`,
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

    task.output = 'Restored successfully';
  }

  private async getReplicationGroupState(
    task: ListrTaskWrapper,
    replicationGroupState: ElasticacheReplicationGroupState,
    replicationGroup: AWS.ElastiCache.ReplicationGroup,
  ): Promise<void> {
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

    task.output = 'Fetching a sample cache cluster...';
    const sampleCacheCluster = await this.describeCacheCluster(
      replicationGroup.MemberClusters[0],
    );

    if (!sampleCacheCluster) {
      throw new Error(`Could not find sample cache cluster`);
    }

    task.output = 'Preparing re-create params...';
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
        (sampleCacheCluster.CacheNodes &&
          sampleCacheCluster.CacheNodes[0]?.Endpoint?.Port) ||
        (replicationGroup.NodeGroups &&
          replicationGroup.NodeGroups[0]?.PrimaryEndpoint?.Port),
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
    task: ListrTaskWrapper,
  ): Promise<AWS.ElastiCache.ReplicationGroupList> {
    const replicationGroups: AWS.ElastiCache.ReplicationGroupList = [];

    // TODO Add logic to go through all pages
    task.output = 'Fetching page 1...';
    replicationGroups.push(
      ...((
        await this.elcClient
          .describeReplicationGroups({ MaxRecords: 100 })
          .promise()
      ).ReplicationGroups as AWS.ElastiCache.ReplicationGroupList),
    );

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

  private static generateSnapshotName(
    replicationGroup: AWS.ElastiCache.ReplicationGroup,
  ) {
    const now = new Date();
    return `${
      replicationGroup.ReplicationGroupId
    }-${now.getFullYear()}${now.getMonth()}${now.getDay()}${now.getHours()}${now.getMinutes()}`;
  }
}
