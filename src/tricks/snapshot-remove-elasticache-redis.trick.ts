import _ from 'lodash';
import AWS from 'aws-sdk';
import Listr, { ListrTaskWrapper } from 'listr';
import chalk from 'chalk';

import { TrickInterface } from '../interfaces/trick.interface';
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

  getDisplayName(): string {
    return 'Snapshot and remove ElastiCache Redis';
  }

  canBeConcurrent(): boolean {
    return true;
  }

  async conserve(
    subListr: Listr,
    dryRun: boolean,
  ): Promise<SnapshotRemoveElasticacheRedisState> {
    const replicationGroups = await this.listReplicationGroups();
    const currentState = await this.getCurrentState(replicationGroups);

    if (currentState.length > 0) {
      for (const replicationGroup of currentState) {
        subListr.add({
          title: chalk.blueBright(replicationGroup.id),
          task: (ctx, task) =>
            this.conserveReplicationGroup(task, dryRun, replicationGroup),
        });
      }
    }

    return currentState;
  }

  async restore(
    subListr: Listr,
    dryRun: boolean,
    originalState: SnapshotRemoveElasticacheRedisState,
  ): Promise<void> {
    for (const singleNodeCluster of originalState) {
      subListr.add({
        title: chalk.blueBright(singleNodeCluster.id),
        task: (ctx, task) =>
          this.restoreReplicationGroup(task, dryRun, singleNodeCluster),
      });
    }
  }

  private async conserveReplicationGroup(
    task: ListrTaskWrapper,
    dryRun: boolean,
    replicationGroupState: ElasticacheReplicationGroupState,
  ): Promise<void> {
    if (dryRun) {
      task.skip('Skipped due to dry-run');
    } else if (replicationGroupState.status === 'available') {
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
    } else {
      task.skip(
        `Skipped, current state is not "available" it is "${replicationGroupState.status}" instead`,
      );
    }
  }

  private async restoreReplicationGroup(
    task: ListrTaskWrapper,
    dryRun: boolean,
    replicationGroupState: ElasticacheReplicationGroupState,
  ): Promise<void> {
    if (dryRun) {
      task.skip('Skipped due to dry-run');
    } else if (replicationGroupState.status === 'available') {
      if (await this.isReplicationGroupAvailable(replicationGroupState)) {
        task.skip('Already exists');
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
    } else {
      task.skip(
        `Skipped, previous state was not "available" it was "${replicationGroupState.status}" instead`,
      );
    }
  }

  private async getCurrentState(
    replicationGroups: AWS.ElastiCache.ReplicationGroupList,
  ) {
    return Promise.all(
      replicationGroups.map(
        async (replicationGroup): Promise<ElasticacheReplicationGroupState> => {
          if (replicationGroup.ARN === undefined) {
            throw new Error(
              `Unexpected error: ARN is missing for ElastiCache replication group`,
            );
          }
          if (replicationGroup.ReplicationGroupId === undefined) {
            throw new Error(
              `Unexpected error: ReplicationGroupId is missing for ElastiCache replication group`,
            );
          }
          if (replicationGroup.Status === undefined) {
            throw new Error(
              `Unexpected error: Status is missing for ElastiCache replication group`,
            );
          }
          if (replicationGroup.AuthTokenEnabled) {
            throw new Error(
              `Cannot conserve an AuthToken protected Redis Cluster because on restore token will change`,
            );
          }

          const cacheClusters = await this.getCacheClusters(replicationGroup);

          const now = new Date();
          const snapshotName = `${
            replicationGroup.ReplicationGroupId
          }-${now.getFullYear()}${now.getMonth()}${now.getDay()}${now.getHours()}${now.getMinutes()}`;
          const nodeGroups =
            replicationGroup.NodeGroups?.map(
              n =>
                ({
                  NodeGroupId: n.NodeGroupId,
                  ReplicaCount: n.NodeGroupMembers?.length,
                  Slots: n.Slots,
                } as AWS.ElastiCache.NodeGroupConfiguration),
            ) || [];

          const createParams: AWS.ElastiCache.CreateReplicationGroupMessage = {
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
              nodeGroups.length > 1 ? undefined : cacheClusters.length,
            NumNodeGroups:
              nodeGroups.length > 1 ? nodeGroups.length : undefined,
            MultiAZEnabled:
              replicationGroup.MultiAZ &&
              replicationGroup.MultiAZ === 'enabled',
            NodeGroupConfiguration:
              nodeGroups.length > 1 ? nodeGroups : undefined,
            GlobalReplicationGroupId:
              replicationGroup.GlobalReplicationGroupInfo
                ?.GlobalReplicationGroupId,
            KmsKeyId: replicationGroup.KmsKeyId,
            AutomaticFailoverEnabled:
              replicationGroup.AutomaticFailover &&
              ['enabled', 'enabling'].includes(
                replicationGroup.AutomaticFailover,
              ),
            Port:
              cacheClusters[0]?.CacheNodes[0]?.Endpoint?.Port ||
              replicationGroup.NodeGroups[0]?.PrimaryEndpoint?.Port,
            Tags: await this.getTags(cacheClusters[0]?.ARN),

            // Cache Clusters Configs
            PreferredCacheClusterAZs:
              nodeGroups.length > 1
                ? undefined
                : _.uniq(
                    cacheClusters
                      .map(c => c.PreferredAvailabilityZone || '')
                      .filter(az => az !== ''),
                  ),
            SecurityGroupIds: _.uniq(
              [].concat(
                ...cacheClusters.map(c =>
                  c.SecurityGroups?.map(s => s.SecurityGroupId),
                ),
              ),
            ),
            CacheSecurityGroupNames: _.uniq(
              [].concat(
                ...cacheClusters.map(c =>
                  c.CacheSecurityGroups?.map(s => s.CacheSecurityGroupName),
                ),
              ),
            ),

            // Shared Cache Cluster Configs
            AutoMinorVersionUpgrade: cacheClusters[0].AutoMinorVersionUpgrade,
            CacheNodeType: cacheClusters[0].CacheNodeType,
            SnapshotRetentionLimit: cacheClusters[0].SnapshotRetentionLimit,
            Engine: cacheClusters[0].Engine,
            EngineVersion: cacheClusters[0].EngineVersion,
            CacheParameterGroupName:
              cacheClusters[0].CacheParameterGroup?.CacheParameterGroupName,
            CacheSubnetGroupName: cacheClusters[0].CacheSubnetGroupName,
            NotificationTopicArn:
              cacheClusters[0].NotificationConfiguration.TopicArn,
            SnapshotWindow: cacheClusters[0].SnapshotWindow,
            PreferredMaintenanceWindow:
              cacheClusters[0].PreferredMaintenanceWindow,
          };

          return {
            id: replicationGroup.ReplicationGroupId,
            status: replicationGroup.Status,
            snapshotName,
            createParams,
          };
        },
      ),
    );
  }

  private async isReplicationGroupAvailable(
    replicationGroupState: ElasticacheReplicationGroupState,
  ) {
    try {
      const result = await this.elcClient
        .describeReplicationGroups({
          ReplicationGroupId: replicationGroupState.id,
        })
        .promise();

      if (result.ReplicationGroups?.length > 0) {
        return true;
      }
    } catch (error) {
      // Skip
    }

    return false;
  }

  private async listReplicationGroups(): Promise<
    AWS.ElastiCache.ReplicationGroupList
  > {
    return (
      (await this.elcClient.describeReplicationGroups({}).promise())
        .ReplicationGroups || []
    );
  }

  private async getCacheClusters(
    replicationGroup: AWS.ElastiCache.ReplicationGroup,
  ): Promise<AWS.ElastiCache.CacheCluster[]> {
    return (
      (
        await this.elcClient
          .describeCacheClusters({
            CacheClusterId: replicationGroup.SnapshottingClusterId,
            ShowCacheNodeInfo: true,
          })
          .promise()
      ).CacheClusters || []
    );
  }

  private async getTags(arn: string) {
    return (
      (
        await this.elcClient
          .listTagsForResource({
            ResourceName: arn,
          })
          .promise()
      ).TagList || []
    );
  }
}
