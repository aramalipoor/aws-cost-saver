import AWS from 'aws-sdk';
import AWSMock from 'aws-sdk-mock';
import { mockProcessStdout } from 'jest-mock-process';
import { ListrTaskWrapper } from 'listr2';

import { createMockTask } from '../util';

import {
  SnapshotRemoveElasticacheRedisTrick,
  SnapshotRemoveElasticacheRedisState,
} from '../../src/tricks/snapshot-remove-elasticache-redis.trick';
import { ElasticacheReplicationGroupState } from '../../src/states/elasticache-replication-group.state';

const SampleReplicationGroupState = {
  id: 'foo',
  snapshotName: 'foo-12345567',
  status: 'available',
  createParams: {
    AtRestEncryptionEnabled: true,
    AutoMinorVersionUpgrade: true,
    AutomaticFailoverEnabled: true,
    CacheNodeType: 'cache.t2.small',
    CacheParameterGroupName: 'baz',
    CacheSecurityGroupNames: ['quuz'],
    CacheSubnetGroupName: 'qux',
    Engine: 'redis',
    EngineVersion: '5.0.6',
    // GlobalReplicationGroupId: undefined,
    KmsKeyId: 'secret-key-id',
    MultiAZEnabled: true,
    // NodeGroupConfiguration: undefined,
    NotificationTopicArn: 'arn:topic/quux',
    NumCacheClusters: 1,
    // NumNodeGroups: undefined,
    Port: 3333,
    PreferredCacheClusterAZs: ['eu-central-1c'],
    PreferredMaintenanceWindow: 'sun:23:00-mon:01:30',
    ReplicationGroupDescription: 'something',
    ReplicationGroupId: 'foo',
    SecurityGroupIds: ['my-sec'],
    SnapshotName: 'foo-12345567',
    SnapshotRetentionLimit: 10,
    SnapshotWindow: '05:00-09:00',
    Tags: [{ Key: 'Name', Value: 'my-cluster' }],
    TransitEncryptionEnabled: true,
  },
};

beforeAll(async done => {
  // AWSMock cannot mock waiters and listTagsForResource at the moment
  AWS.ElastiCache.prototype.waitFor = jest.fn().mockImplementation(() => ({
    promise: jest.fn(),
  }));
  AWS.ElastiCache.prototype.listTagsForResource = jest
    .fn()
    .mockImplementation(() => ({
      promise: () =>
        ({
          TagList: [{ Key: 'Name', Value: 'my-cluster' }],
        } as AWS.ElastiCache.TagListMessage),
    }));

  mockProcessStdout();
  done();
});

describe('snapshot-remove-elasticache-redis', () => {
  let task: ListrTaskWrapper<any, any>;

  beforeEach(() => {
    task = createMockTask();
  });

  it('returns correct machine name', async () => {
    const instance = new SnapshotRemoveElasticacheRedisTrick();
    expect(instance.getMachineName()).toBe(
      SnapshotRemoveElasticacheRedisTrick.machineName,
    );
  });

  it('returns an empty Listr if no replication groups found', async () => {
    AWSMock.setSDKInstance(AWS);

    AWSMock.mock(
      'ElastiCache',
      'describeReplicationGroups',
      (
        params: AWS.ElastiCache.Types.DescribeReplicationGroupsMessage,
        callback: Function,
      ) => {
        callback(null, {
          ReplicationGroups: [],
        } as AWS.ElastiCache.Types.ReplicationGroupMessage);
      },
    );

    const instance = new SnapshotRemoveElasticacheRedisTrick();
    const stateObject: SnapshotRemoveElasticacheRedisState = [];
    const listr = await instance.getCurrentState(task, stateObject, {
      dryRun: false,
    });

    expect(listr.tasks.length).toBe(0);

    AWSMock.restore('ElastiCache');
  });

  it('errors if required fields were not returned by AWS', async () => {
    AWSMock.setSDKInstance(AWS);

    AWSMock.mock(
      'ElastiCache',
      'describeReplicationGroups',
      (
        params: AWS.ElastiCache.Types.DescribeReplicationGroupsMessage,
        callback: Function,
      ) => {
        callback(null, {
          ReplicationGroups: [
            { Status: 'available' },
            { ReplicationGroupId: 'foo', Status: 'available' },
            { ReplicationGroupId: 'foo', ARN: 'arn:elasticachecluster/foo' },
            {
              ReplicationGroupId: 'foo',
              ARN: 'arn:elasticachecluster/foo',
              Status: 'available',
              MemberClusters: null,
            },
            {
              ReplicationGroupId: 'foo',
              ARN: 'arn:elasticachecluster/foo',
              Status: 'available',
              MemberClusters: [],
            },
          ],
        } as AWS.ElastiCache.Types.ReplicationGroupMessage);
      },
    );

    const instance = new SnapshotRemoveElasticacheRedisTrick();
    const stateObject: SnapshotRemoveElasticacheRedisState = [];
    const listr = await instance.getCurrentState(task, stateObject, {
      dryRun: false,
    });

    await listr.run();

    expect(listr.err).toStrictEqual([
      expect.objectContaining({
        errors: [
          expect.objectContaining({
            message: expect.stringMatching(/ReplicationGroupId is missing/gi),
          }),
          expect.objectContaining({
            message: expect.stringMatching(/ARN is missing/gi),
          }),
          expect.objectContaining({
            message: expect.stringMatching(/Status is missing/gi),
          }),
          expect.objectContaining({
            message: expect.stringMatching(/No member clusters/gi),
          }),
          expect.objectContaining({
            message: expect.stringMatching(/No member clusters/gi),
          }),
        ],
      }),
    ]);

    AWSMock.restore('ElastiCache');
  });

  it('errors if AuthToken is enabled for Redis cluster', async () => {
    AWSMock.setSDKInstance(AWS);

    AWSMock.mock(
      'ElastiCache',
      'describeReplicationGroups',
      (
        params: AWS.ElastiCache.Types.DescribeReplicationGroupsMessage,
        callback: Function,
      ) => {
        callback(null, {
          ReplicationGroups: [
            {
              ReplicationGroupId: 'foo',
              ARN: 'arn:elasticachecluster/foo',
              Status: 'available',
              AuthTokenEnabled: true,
              MemberClusters: ['bar'],
            },
          ],
        } as AWS.ElastiCache.Types.ReplicationGroupMessage);
      },
    );

    const instance = new SnapshotRemoveElasticacheRedisTrick();
    const stateObject: SnapshotRemoveElasticacheRedisState = [];
    const listr = await instance.getCurrentState(task, stateObject, {
      dryRun: false,
    });

    await listr.run();

    expect(listr.err).toStrictEqual([
      expect.objectContaining({
        errors: [
          expect.objectContaining({
            message: expect.stringMatching(/Cannot conserve an AuthToken/gi),
          }),
        ],
      }),
    ]);

    AWSMock.restore('ElastiCache');
  });

  it('errors if could not describe sample cluster', async () => {
    AWSMock.setSDKInstance(AWS);

    AWSMock.mock(
      'ElastiCache',
      'describeReplicationGroups',
      (
        params: AWS.ElastiCache.Types.DescribeReplicationGroupsMessage,
        callback: Function,
      ) => {
        callback(null, {
          ReplicationGroups: [
            {
              ReplicationGroupId: 'foo',
              Status: 'available',
              ARN: 'arn:elasticachecluster/foo',
              MemberClusters: ['bar'],
              AtRestEncryptionEnabled: true,
              TransitEncryptionEnabled: true,
              MultiAZ: 'enabled',
              Description: 'something',
              KmsKeyId: 'secret-key-id',
              AutomaticFailover: 'enabled',
            },
          ],
        } as AWS.ElastiCache.Types.ReplicationGroupMessage);
      },
    );

    AWSMock.mock(
      'ElastiCache',
      'describeCacheClusters',
      (
        params: AWS.ElastiCache.Types.DescribeCacheClustersMessage,
        callback: Function,
      ) => {
        callback(null, {
          CacheClusters: [],
        } as AWS.ElastiCache.Types.CacheClusterMessage);
      },
    );

    const instance = new SnapshotRemoveElasticacheRedisTrick();
    const stateObject: SnapshotRemoveElasticacheRedisState = [];
    const listr = await instance.getCurrentState(task, stateObject, {
      dryRun: false,
    });

    await listr.run();

    expect(listr.err).toStrictEqual([
      expect.objectContaining({
        errors: [
          expect.objectContaining({
            message: expect.stringMatching(/Could not find sample/gi),
          }),
        ],
      }),
    ]);

    AWSMock.restore('ElastiCache');
  });

  it('generates state object for ElastiCache redis clusters', async () => {
    AWSMock.setSDKInstance(AWS);

    AWSMock.mock(
      'ElastiCache',
      'describeReplicationGroups',
      (
        params: AWS.ElastiCache.Types.DescribeReplicationGroupsMessage,
        callback: Function,
      ) => {
        callback(null, {
          ReplicationGroups: [
            {
              ReplicationGroupId: 'foo',
              Status: 'available',
              ARN: 'arn:elasticachecluster/foo',
              MemberClusters: ['bar'],
              AtRestEncryptionEnabled: true,
              TransitEncryptionEnabled: true,
              MultiAZ: 'enabled',
              Description: 'something',
              KmsKeyId: 'secret-key-id',
              AutomaticFailover: 'enabled',
              NodeGroups: [{ NodeGroupId: 'qux', Slots: '0-50000' }],
            },
          ],
        } as AWS.ElastiCache.Types.ReplicationGroupMessage);
      },
    );

    AWSMock.mock(
      'ElastiCache',
      'describeCacheClusters',
      (
        params: AWS.ElastiCache.Types.DescribeCacheClustersMessage,
        callback: Function,
      ) => {
        callback(null, {
          CacheClusters: [
            {
              AutoMinorVersionUpgrade: true,
              CacheNodeType: 'cache.t2.small',
              SnapshotRetentionLimit: 10,
              Engine: 'redis',
              EngineVersion: '5.0.6',
              CacheParameterGroup: { CacheParameterGroupName: 'baz' },
              CacheSubnetGroupName: 'qux',
              CacheSecurityGroups: [{ CacheSecurityGroupName: 'quuz' }],
              SecurityGroups: [{ SecurityGroupId: 'my-sec' }],
              NotificationConfiguration: { TopicArn: 'arn:topic/quux' },
              SnapshotWindow: '05:00-09:00',
              PreferredMaintenanceWindow: 'sun:23:00-mon:01:30',
              PreferredAvailabilityZone: 'eu-central-1c',
              CacheNodes: [{ Endpoint: { Port: 3333 } }],
            },
          ],
        } as AWS.ElastiCache.Types.CacheClusterMessage);
      },
    );

    const instance = new SnapshotRemoveElasticacheRedisTrick();
    const stateObject: SnapshotRemoveElasticacheRedisState = [];
    const listr = await instance.getCurrentState(task, stateObject, {
      dryRun: false,
    });

    await listr.run({});

    expect(stateObject.pop()).toStrictEqual(
      expect.objectContaining({
        id: 'foo',
        snapshotName: expect.any(String),
        status: 'available',
        createParams: {
          AtRestEncryptionEnabled: true,
          AutoMinorVersionUpgrade: true,
          AutomaticFailoverEnabled: true,
          CacheNodeType: 'cache.t2.small',
          CacheParameterGroupName: 'baz',
          CacheSecurityGroupNames: ['quuz'],
          CacheSubnetGroupName: 'qux',
          Engine: 'redis',
          EngineVersion: '5.0.6',
          // GlobalReplicationGroupId: undefined,
          KmsKeyId: 'secret-key-id',
          MultiAZEnabled: true,
          // NodeGroupConfiguration: undefined,
          NotificationTopicArn: 'arn:topic/quux',
          NumCacheClusters: 1,
          // NumNodeGroups: undefined,
          Port: 3333,
          PreferredCacheClusterAZs: ['eu-central-1c'],
          PreferredMaintenanceWindow: 'sun:23:00-mon:01:30',
          ReplicationGroupDescription: 'something',
          ReplicationGroupId: 'foo',
          SecurityGroupIds: ['my-sec'],
          SnapshotName: expect.any(String),
          SnapshotRetentionLimit: 10,
          SnapshotWindow: '05:00-09:00',
          Tags: [{ Key: 'Name', Value: 'my-cluster' }],
          TransitEncryptionEnabled: true,
        },
      } as ElasticacheReplicationGroupState),
    );

    AWSMock.restore('ElastiCache');
  });

  it('generates state object for ElastiCache redis clusters without PreferredAvailabilityZone', async () => {
    AWSMock.setSDKInstance(AWS);

    AWSMock.mock(
      'ElastiCache',
      'describeReplicationGroups',
      (
        params: AWS.ElastiCache.Types.DescribeReplicationGroupsMessage,
        callback: Function,
      ) => {
        callback(null, {
          ReplicationGroups: [
            {
              ReplicationGroupId: 'foo',
              Status: 'available',
              ARN: 'arn:elasticachecluster/foo',
              MemberClusters: ['bar'],
              AtRestEncryptionEnabled: true,
              TransitEncryptionEnabled: true,
              MultiAZ: 'enabled',
              Description: 'something',
              KmsKeyId: 'secret-key-id',
              AutomaticFailover: 'enabled',
              NodeGroups: [{ NodeGroupId: 'qux', Slots: '0-50000' }],
            },
          ],
        } as AWS.ElastiCache.Types.ReplicationGroupMessage);
      },
    );

    AWSMock.mock(
      'ElastiCache',
      'describeCacheClusters',
      (
        params: AWS.ElastiCache.Types.DescribeCacheClustersMessage,
        callback: Function,
      ) => {
        callback(null, {
          CacheClusters: [
            {
              AutoMinorVersionUpgrade: true,
              CacheNodeType: 'cache.t2.small',
              SnapshotRetentionLimit: 10,
              Engine: 'redis',
              EngineVersion: '5.0.6',
              CacheParameterGroup: { CacheParameterGroupName: 'baz' },
              CacheSubnetGroupName: 'qux',
              CacheSecurityGroups: [{ CacheSecurityGroupName: 'quuz' }],
              SecurityGroups: [{ SecurityGroupId: 'my-sec' }],
              NotificationConfiguration: { TopicArn: 'arn:topic/quux' },
              SnapshotWindow: '05:00-09:00',
              PreferredMaintenanceWindow: 'sun:23:00-mon:01:30',
              // PreferredAvailabilityZone: 'eu-central-1c',
              CacheNodes: [{ Endpoint: { Port: 3333 } }],
            },
          ],
        } as AWS.ElastiCache.Types.CacheClusterMessage);
      },
    );

    const instance = new SnapshotRemoveElasticacheRedisTrick();
    const stateObject: SnapshotRemoveElasticacheRedisState = [];
    const listr = await instance.getCurrentState(task, stateObject, {
      dryRun: false,
    });

    await listr.run({});

    expect(stateObject.pop()).toStrictEqual(
      expect.objectContaining({
        id: 'foo',
        snapshotName: expect.any(String),
        status: 'available',
        createParams: {
          AtRestEncryptionEnabled: true,
          AutoMinorVersionUpgrade: true,
          AutomaticFailoverEnabled: true,
          CacheNodeType: 'cache.t2.small',
          CacheParameterGroupName: 'baz',
          CacheSecurityGroupNames: ['quuz'],
          CacheSubnetGroupName: 'qux',
          Engine: 'redis',
          EngineVersion: '5.0.6',
          // GlobalReplicationGroupId: undefined,
          KmsKeyId: 'secret-key-id',
          MultiAZEnabled: true,
          // NodeGroupConfiguration: undefined,
          NotificationTopicArn: 'arn:topic/quux',
          NumCacheClusters: 1,
          // NumNodeGroups: undefined,
          Port: 3333,
          // PreferredCacheClusterAZs: ['eu-central-1c'],
          PreferredMaintenanceWindow: 'sun:23:00-mon:01:30',
          ReplicationGroupDescription: 'something',
          ReplicationGroupId: 'foo',
          SecurityGroupIds: ['my-sec'],
          SnapshotName: expect.any(String),
          SnapshotRetentionLimit: 10,
          SnapshotWindow: '05:00-09:00',
          Tags: [{ Key: 'Name', Value: 'my-cluster' }],
          TransitEncryptionEnabled: true,
        },
      } as ElasticacheReplicationGroupState),
    );

    AWSMock.restore('ElastiCache');
  });

  it('generates state object for ElastiCache redis clusters without description', async () => {
    AWSMock.setSDKInstance(AWS);

    AWSMock.mock(
      'ElastiCache',
      'describeReplicationGroups',
      (
        params: AWS.ElastiCache.Types.DescribeReplicationGroupsMessage,
        callback: Function,
      ) => {
        callback(null, {
          ReplicationGroups: [
            {
              ReplicationGroupId: 'foo',
              Status: 'available',
              ARN: 'arn:elasticachecluster/foo',
              MemberClusters: ['bar'],
              AtRestEncryptionEnabled: true,
              TransitEncryptionEnabled: true,
              MultiAZ: 'enabled',
              KmsKeyId: 'secret-key-id',
              AutomaticFailover: 'enabled',
              NodeGroups: [{ NodeGroupId: 'qux', Slots: '0-50000' }],
            },
          ],
        } as AWS.ElastiCache.Types.ReplicationGroupMessage);
      },
    );

    AWSMock.mock(
      'ElastiCache',
      'describeCacheClusters',
      (
        params: AWS.ElastiCache.Types.DescribeCacheClustersMessage,
        callback: Function,
      ) => {
        callback(null, {
          CacheClusters: [
            {
              AutoMinorVersionUpgrade: true,
              CacheNodeType: 'cache.t2.small',
              SnapshotRetentionLimit: 10,
              Engine: 'redis',
              EngineVersion: '5.0.6',
              CacheParameterGroup: { CacheParameterGroupName: 'baz' },
              CacheSubnetGroupName: 'qux',
              CacheSecurityGroups: [{ CacheSecurityGroupName: 'quuz' }],
              SecurityGroups: [{ SecurityGroupId: 'my-sec' }],
              NotificationConfiguration: { TopicArn: 'arn:topic/quux' },
              SnapshotWindow: '05:00-09:00',
              PreferredMaintenanceWindow: 'sun:23:00-mon:01:30',
              PreferredAvailabilityZone: 'eu-central-1c',
              CacheNodes: [{ Endpoint: { Port: 3333 } }],
            },
          ],
        } as AWS.ElastiCache.Types.CacheClusterMessage);
      },
    );

    const instance = new SnapshotRemoveElasticacheRedisTrick();
    const stateObject: SnapshotRemoveElasticacheRedisState = [];
    const listr = await instance.getCurrentState(task, stateObject, {
      dryRun: false,
    });

    await listr.run({});

    expect(stateObject.pop()).toStrictEqual(
      expect.objectContaining({
        id: 'foo',
        snapshotName: expect.any(String),
        status: 'available',
        createParams: {
          AtRestEncryptionEnabled: true,
          AutoMinorVersionUpgrade: true,
          AutomaticFailoverEnabled: true,
          CacheNodeType: 'cache.t2.small',
          CacheParameterGroupName: 'baz',
          CacheSecurityGroupNames: ['quuz'],
          CacheSubnetGroupName: 'qux',
          Engine: 'redis',
          EngineVersion: '5.0.6',
          // GlobalReplicationGroupId: undefined,
          KmsKeyId: 'secret-key-id',
          MultiAZEnabled: true,
          // NodeGroupConfiguration: undefined,
          NotificationTopicArn: 'arn:topic/quux',
          NumCacheClusters: 1,
          // NumNodeGroups: undefined,
          Port: 3333,
          PreferredCacheClusterAZs: ['eu-central-1c'],
          PreferredMaintenanceWindow: 'sun:23:00-mon:01:30',
          ReplicationGroupDescription: expect.any(String),
          ReplicationGroupId: 'foo',
          SecurityGroupIds: ['my-sec'],
          SnapshotName: expect.any(String),
          SnapshotRetentionLimit: 10,
          SnapshotWindow: '05:00-09:00',
          Tags: [{ Key: 'Name', Value: 'my-cluster' }],
          TransitEncryptionEnabled: true,
        },
      } as ElasticacheReplicationGroupState),
    );

    AWSMock.restore('ElastiCache');
  });

  it('generates state object for ElastiCache redis clusters with multiple NodeGroups', async () => {
    AWSMock.setSDKInstance(AWS);

    AWSMock.mock(
      'ElastiCache',
      'describeReplicationGroups',
      (
        params: AWS.ElastiCache.Types.DescribeReplicationGroupsMessage,
        callback: Function,
      ) => {
        callback(null, {
          ReplicationGroups: [
            {
              ReplicationGroupId: 'foo',
              Status: 'available',
              ARN: 'arn:elasticachecluster/foo',
              MemberClusters: ['bar'],
              AtRestEncryptionEnabled: true,
              TransitEncryptionEnabled: true,
              MultiAZ: 'enabled',
              Description: 'something',
              KmsKeyId: 'secret-key-id',
              AutomaticFailover: 'enabled',
              NodeGroups: [
                { NodeGroupId: 'qux', Slots: '0-1000' },
                { NodeGroupId: 'quuz', Slots: '1000-50000' },
              ],
            },
          ],
        } as AWS.ElastiCache.Types.ReplicationGroupMessage);
      },
    );

    AWSMock.mock(
      'ElastiCache',
      'describeCacheClusters',
      (
        params: AWS.ElastiCache.Types.DescribeCacheClustersMessage,
        callback: Function,
      ) => {
        callback(null, {
          CacheClusters: [
            {
              AutoMinorVersionUpgrade: true,
              CacheNodeType: 'cache.t2.small',
              SnapshotRetentionLimit: 10,
              Engine: 'redis',
              EngineVersion: '5.0.6',
              CacheParameterGroup: { CacheParameterGroupName: 'baz' },
              CacheSubnetGroupName: 'qux',
              CacheSecurityGroups: [{ CacheSecurityGroupName: 'quuz' }],
              SecurityGroups: [{ SecurityGroupId: 'my-sec' }],
              NotificationConfiguration: { TopicArn: 'arn:topic/quux' },
              SnapshotWindow: '05:00-09:00',
              PreferredMaintenanceWindow: 'sun:23:00-mon:01:30',
              PreferredAvailabilityZone: 'eu-central-1c',
              CacheNodes: [{ Endpoint: { Port: 3333 } }],
            },
          ],
        } as AWS.ElastiCache.Types.CacheClusterMessage);
      },
    );

    const instance = new SnapshotRemoveElasticacheRedisTrick();
    const stateObject: SnapshotRemoveElasticacheRedisState = [];
    const listr = await instance.getCurrentState(task, stateObject, {
      dryRun: false,
    });

    await listr.run({});

    expect(stateObject).toStrictEqual([
      {
        id: 'foo',
        snapshotName: expect.any(String),
        status: 'available',
        createParams: {
          AtRestEncryptionEnabled: true,
          AutoMinorVersionUpgrade: true,
          AutomaticFailoverEnabled: true,
          CacheNodeType: 'cache.t2.small',
          CacheParameterGroupName: 'baz',
          CacheSecurityGroupNames: ['quuz'],
          CacheSubnetGroupName: 'qux',
          Engine: 'redis',
          EngineVersion: '5.0.6',
          GlobalReplicationGroupId: undefined,
          KmsKeyId: 'secret-key-id',
          MultiAZEnabled: true,
          NodeGroupConfiguration: [
            {
              NodeGroupId: 'qux',
              ReplicaCount: undefined,
              Slots: '0-1000',
            },
            {
              NodeGroupId: 'quuz',
              ReplicaCount: undefined,
              Slots: '1000-50000',
            },
          ],
          NotificationTopicArn: 'arn:topic/quux',
          NumCacheClusters: undefined,
          NumNodeGroups: 2,
          Port: 3333,
          PreferredCacheClusterAZs: undefined,
          PreferredMaintenanceWindow: 'sun:23:00-mon:01:30',
          ReplicationGroupDescription: 'something',
          ReplicationGroupId: 'foo',
          SecurityGroupIds: ['my-sec'],
          SnapshotName: expect.any(String),
          SnapshotRetentionLimit: 10,
          SnapshotWindow: '05:00-09:00',
          Tags: [{ Key: 'Name', Value: 'my-cluster' }],
          TransitEncryptionEnabled: true,
        },
      } as ElasticacheReplicationGroupState,
    ]);

    AWSMock.restore('ElastiCache');
  });

  it('generates state object for ElastiCache redis clusters without NodeGroups', async () => {
    AWSMock.setSDKInstance(AWS);

    AWSMock.mock(
      'ElastiCache',
      'describeReplicationGroups',
      (
        params: AWS.ElastiCache.Types.DescribeReplicationGroupsMessage,
        callback: Function,
      ) => {
        callback(null, {
          ReplicationGroups: [
            {
              ReplicationGroupId: 'foo',
              Status: 'available',
              ARN: 'arn:elasticachecluster/foo',
              MemberClusters: ['bar'],
              AtRestEncryptionEnabled: true,
              TransitEncryptionEnabled: true,
              MultiAZ: 'enabled',
              Description: 'something',
              KmsKeyId: 'secret-key-id',
              AutomaticFailover: 'enabled',
              NodeGroups: undefined,
            },
          ],
        } as AWS.ElastiCache.Types.ReplicationGroupMessage);
      },
    );

    AWSMock.mock(
      'ElastiCache',
      'describeCacheClusters',
      (
        params: AWS.ElastiCache.Types.DescribeCacheClustersMessage,
        callback: Function,
      ) => {
        callback(null, {
          CacheClusters: [
            {
              AutoMinorVersionUpgrade: true,
              CacheNodeType: 'cache.t2.small',
              SnapshotRetentionLimit: 10,
              Engine: 'redis',
              EngineVersion: '5.0.6',
              CacheParameterGroup: { CacheParameterGroupName: 'baz' },
              CacheSubnetGroupName: 'qux',
              CacheSecurityGroups: [{ CacheSecurityGroupName: 'quuz' }],
              SecurityGroups: [{ SecurityGroupId: 'my-sec' }],
              NotificationConfiguration: { TopicArn: 'arn:topic/quux' },
              SnapshotWindow: '05:00-09:00',
              PreferredMaintenanceWindow: 'sun:23:00-mon:01:30',
              PreferredAvailabilityZone: 'eu-central-1c',
              CacheNodes: [{ Endpoint: { Port: 3333 } }],
            },
          ],
        } as AWS.ElastiCache.Types.CacheClusterMessage);
      },
    );

    const instance = new SnapshotRemoveElasticacheRedisTrick();
    const stateObject: SnapshotRemoveElasticacheRedisState = [];
    const listr = await instance.getCurrentState(task, stateObject, {
      dryRun: false,
    });

    await listr.run({});

    expect(stateObject).toStrictEqual([
      {
        id: 'foo',
        snapshotName: expect.any(String),
        status: 'available',
        createParams: {
          AtRestEncryptionEnabled: true,
          AutoMinorVersionUpgrade: true,
          AutomaticFailoverEnabled: true,
          CacheNodeType: 'cache.t2.small',
          CacheParameterGroupName: 'baz',
          CacheSecurityGroupNames: ['quuz'],
          CacheSubnetGroupName: 'qux',
          Engine: 'redis',
          EngineVersion: '5.0.6',
          GlobalReplicationGroupId: undefined,
          KmsKeyId: 'secret-key-id',
          MultiAZEnabled: true,
          NodeGroupConfiguration: undefined,
          NotificationTopicArn: 'arn:topic/quux',
          NumCacheClusters: 1,
          NumNodeGroups: undefined,
          Port: 3333,
          PreferredCacheClusterAZs: ['eu-central-1c'],
          PreferredMaintenanceWindow: 'sun:23:00-mon:01:30',
          ReplicationGroupDescription: 'something',
          ReplicationGroupId: 'foo',
          SecurityGroupIds: ['my-sec'],
          SnapshotName: expect.any(String),
          SnapshotRetentionLimit: 10,
          SnapshotWindow: '05:00-09:00',
          Tags: [{ Key: 'Name', Value: 'my-cluster' }],
          TransitEncryptionEnabled: true,
        },
      } as ElasticacheReplicationGroupState,
    ]);

    AWSMock.restore('ElastiCache');
  });

  it('conserves ElastiCache redis cluster', async () => {
    AWSMock.setSDKInstance(AWS);

    const deleteReplicationGroupSpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback(null, {});
      });
    AWSMock.mock(
      'ElastiCache',
      'deleteReplicationGroup',
      deleteReplicationGroupSpy,
    );

    const instance = new SnapshotRemoveElasticacheRedisTrick();
    const stateObject: SnapshotRemoveElasticacheRedisState = [
      SampleReplicationGroupState,
    ];
    const conserveListr = await instance.conserve(task, stateObject, {
      dryRun: false,
    });

    await conserveListr.run({});

    expect(deleteReplicationGroupSpy).toBeCalledWith(
      expect.objectContaining({
        ReplicationGroupId: SampleReplicationGroupState.id,
        FinalSnapshotIdentifier: SampleReplicationGroupState.snapshotName,
      }),
      expect.anything(),
    );

    AWSMock.restore('ElastiCache');
  });

  it('skips conserve if no clusters found', async () => {
    AWSMock.setSDKInstance(AWS);

    const deleteReplicationGroupSpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback(null, {});
      });
    AWSMock.mock(
      'ElastiCache',
      'deleteReplicationGroup',
      deleteReplicationGroupSpy,
    );

    const instance = new SnapshotRemoveElasticacheRedisTrick();
    const stateObject: SnapshotRemoveElasticacheRedisState = [];

    const conserveListr = await instance.conserve(task, stateObject, {
      dryRun: false,
    });

    await conserveListr.run({});

    expect(deleteReplicationGroupSpy).not.toBeCalled();

    AWSMock.restore('ElastiCache');
  });

  it('skips conserve if status is not "available"', async () => {
    AWSMock.setSDKInstance(AWS);

    const deleteReplicationGroupSpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback(null, {});
      });
    AWSMock.mock(
      'ElastiCache',
      'deleteReplicationGroup',
      deleteReplicationGroupSpy,
    );

    const instance = new SnapshotRemoveElasticacheRedisTrick();
    const stateObject: SnapshotRemoveElasticacheRedisState = [
      {
        ...SampleReplicationGroupState,
        status: 'pending',
      },
    ];

    const conserveListr = await instance.conserve(task, stateObject, {
      dryRun: false,
    });

    await conserveListr.run({});

    expect(deleteReplicationGroupSpy).not.toBeCalled();

    AWSMock.restore('ElastiCache');
  });

  it('skips conserve if dry-run option is enabled', async () => {
    AWSMock.setSDKInstance(AWS);

    const deleteReplicationGroupSpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback(null, {});
      });
    AWSMock.mock(
      'ElastiCache',
      'deleteReplicationGroup',
      deleteReplicationGroupSpy,
    );

    const instance = new SnapshotRemoveElasticacheRedisTrick();
    const stateObject: SnapshotRemoveElasticacheRedisState = [
      SampleReplicationGroupState,
    ];

    const conserveListr = await instance.conserve(task, stateObject, {
      dryRun: true,
    });

    await conserveListr.run({});

    expect(deleteReplicationGroupSpy).not.toBeCalled();

    AWSMock.restore('ElastiCache');
  });

  it('restores removed ElastiCache Redis cluster', async () => {
    AWSMock.setSDKInstance(AWS);

    const createReplicationGroupSpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback(null, {
          ReplicationGroup: {
            ReplicationGroupId: 'newfoo',
          },
        } as AWS.ElastiCache.CreateReplicationGroupResult);
      });
    AWSMock.mock(
      'ElastiCache',
      'createReplicationGroup',
      createReplicationGroupSpy,
    );
    const describeReplicationGroupsSpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback(null, {
          ReplicationGroups: [],
        } as AWS.ElastiCache.ReplicationGroupMessage);
      });
    AWSMock.mock(
      'ElastiCache',
      'describeReplicationGroups',
      describeReplicationGroupsSpy,
    );
    const deleteSnapshotSpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback(null, {});
      });
    AWSMock.mock('ElastiCache', 'deleteSnapshot', deleteSnapshotSpy);

    const instance = new SnapshotRemoveElasticacheRedisTrick();
    const stateObject: SnapshotRemoveElasticacheRedisState = [
      SampleReplicationGroupState,
    ];
    const restoreListr = await instance.restore(task, stateObject, {
      dryRun: false,
    });

    await restoreListr.run({});

    expect(createReplicationGroupSpy).toBeCalledWith(
      expect.objectContaining(SampleReplicationGroupState.createParams),
      expect.anything(),
    );
    expect(deleteSnapshotSpy).toBeCalledWith(
      expect.objectContaining({
        SnapshotName: SampleReplicationGroupState.snapshotName,
      }),
      expect.anything(),
    );

    AWSMock.restore('ElastiCache');
  });

  it('skips restore if ElastiCache Redis cluster already exists', async () => {
    AWSMock.setSDKInstance(AWS);

    const createReplicationGroupSpy = jest.fn();
    AWSMock.mock(
      'ElastiCache',
      'createReplicationGroup',
      createReplicationGroupSpy,
    );
    const describeReplicationGroupsSpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback(null, {
          ReplicationGroups: [
            {
              ReplicationGroupId: SampleReplicationGroupState.id,
              Status: 'available',
            },
          ],
        } as AWS.ElastiCache.ReplicationGroupMessage);
      });
    AWSMock.mock(
      'ElastiCache',
      'describeReplicationGroups',
      describeReplicationGroupsSpy,
    );
    const deleteSnapshotSpy = jest.fn();
    AWSMock.mock('ElastiCache', 'deleteSnapshot', deleteSnapshotSpy);

    const instance = new SnapshotRemoveElasticacheRedisTrick();
    const stateObject: SnapshotRemoveElasticacheRedisState = [
      SampleReplicationGroupState,
    ];
    const restoreListr = await instance.restore(task, stateObject, {
      dryRun: false,
    });

    await restoreListr.run({});

    expect(createReplicationGroupSpy).not.toBeCalled();
    expect(deleteSnapshotSpy).not.toBeCalled();

    AWSMock.restore('ElastiCache');
  });

  it('skips restore if status was not "available"', async () => {
    AWSMock.setSDKInstance(AWS);

    const createReplicationGroupSpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback(null, {});
      });
    AWSMock.mock(
      'ElastiCache',
      'createReplicationGroup',
      createReplicationGroupSpy,
    );

    const instance = new SnapshotRemoveElasticacheRedisTrick();
    const stateObject: SnapshotRemoveElasticacheRedisState = [
      { ...SampleReplicationGroupState, status: 'pending' },
    ];

    const restoreListr = await instance.restore(task, stateObject, {
      dryRun: false,
    });

    await restoreListr.run({});

    expect(createReplicationGroupSpy).not.toBeCalled();

    AWSMock.restore('ElastiCache');
  });

  it('skips restore if no clusters were conserved', async () => {
    AWSMock.setSDKInstance(AWS);

    const createReplicationGroupSpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback(null, {});
      });
    AWSMock.mock(
      'ElastiCache',
      'createReplicationGroup',
      createReplicationGroupSpy,
    );

    const instance = new SnapshotRemoveElasticacheRedisTrick();
    const stateObject: SnapshotRemoveElasticacheRedisState = [];

    const restoreListr = await instance.restore(task, stateObject, {
      dryRun: false,
    });

    await restoreListr.run({});

    expect(createReplicationGroupSpy).not.toBeCalled();

    AWSMock.restore('ElastiCache');
  });

  it('skips restore if dry-run option is enabled', async () => {
    AWSMock.setSDKInstance(AWS);

    const createReplicationGroupSpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback(null, {});
      });
    AWSMock.mock(
      'ElastiCache',
      'createReplicationGroup',
      createReplicationGroupSpy,
    );
    const describeReplicationGroupsSpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback(null, {
          ReplicationGroups: [],
        } as AWS.ElastiCache.ReplicationGroupMessage);
      });
    AWSMock.mock(
      'ElastiCache',
      'describeReplicationGroups',
      describeReplicationGroupsSpy,
    );

    const instance = new SnapshotRemoveElasticacheRedisTrick();
    const stateObject: SnapshotRemoveElasticacheRedisState = [
      SampleReplicationGroupState,
    ];

    const restoreListr = await instance.restore(task, stateObject, {
      dryRun: true,
    });

    await restoreListr.run({});

    expect(createReplicationGroupSpy).not.toBeCalled();

    AWSMock.restore('ElastiCache');
  });

  it('errors on restore if required fields are missing in state', async () => {
    const instance = new SnapshotRemoveElasticacheRedisTrick();
    const stateObject = ([
      {
        id: 'foo',
        createParams: SampleReplicationGroupState.createParams,
      },
      {
        id: 'foo',
        snapshotName: SampleReplicationGroupState.snapshotName,
      },
    ] as unknown) as SnapshotRemoveElasticacheRedisState;

    const listr = await instance.restore(task, stateObject, {
      dryRun: false,
    });

    await listr.run();

    expect(listr.err).toStrictEqual([
      expect.objectContaining({
        errors: [
          expect.objectContaining({
            message: expect.stringMatching(/snapshotName is missing/gi),
          }),
          expect.objectContaining({
            message: expect.stringMatching(/createParams is missing/gi),
          }),
        ],
      }),
    ]);
  });
});
