import AWS from 'aws-sdk';
import AWSMock from 'aws-sdk-mock';
import { mockProcessStdout } from 'jest-mock-process';
import { ListrTaskWrapper } from 'listr2';
import nock from 'nock';

import {
  StopRdsDatabaseInstancesTrick,
  StopRdsDatabaseInstancesState,
} from '../../src/tricks/stop-rds-database-instances.trick';
import { TrickContext } from '../../src/types/trick-context';
import { RdsDatabaseState } from '../../src/states/rds-database.state';
import { TrickOptionsInterface } from '../../src/types/trick-options.interface';

import { createMockTask } from '../util';

beforeAll(async done => {
  nock.abortPendingRequests();
  nock.cleanAll();
  nock.disableNetConnect();

  // AWSMock cannot mock waiters at the moment
  AWS.RDS.prototype.waitFor = jest.fn().mockImplementation(() => ({
    promise: jest.fn(),
  }));

  mockProcessStdout();
  done();
});

afterEach(async () => {
  const pending = nock.pendingMocks();

  if (pending.length > 0) {
    // eslint-disable-next-line no-console
    console.log(pending);
    throw new Error(`${pending.length} mocks are pending!`);
  }
});

describe('stop-rds-database-instances', () => {
  let task: ListrTaskWrapper<any, any>;

  beforeEach(() => {
    task = createMockTask();
  });

  it('returns correct machine name', async () => {
    const instance = new StopRdsDatabaseInstancesTrick();
    expect(instance.getMachineName()).toBe(
      StopRdsDatabaseInstancesTrick.machineName,
    );
  });

  it('prepares resource tags', async () => {
    AWSMock.setSDKInstance(AWS);

    AWSMock.mock(
      'ResourceGroupsTaggingAPI',
      'getResources',
      (
        params: AWS.ResourceGroupsTaggingAPI.GetResourcesInput,
        callback: Function,
      ) => {
        callback(null, {
          ResourceTagMappingList: [
            { ResourceARN: 'arn:rds:cluster/foo' },
            { ResourceARN: 'arn:rds:cluster/bar' },
          ],
        } as AWS.ResourceGroupsTaggingAPI.GetResourcesOutput);
      },
    );

    const instance = new StopRdsDatabaseInstancesTrick();
    const trickContext: TrickContext = {};
    await instance.prepareTags(task, trickContext, {} as TrickOptionsInterface);

    expect(trickContext).toMatchObject({
      resourceTagMappings: [
        { ResourceARN: 'arn:rds:cluster/foo' },
        { ResourceARN: 'arn:rds:cluster/bar' },
      ],
    });

    AWSMock.restore('ResourceGroupsTaggingAPI');
  });

  it('returns an empty Listr if no databases found', async () => {
    AWSMock.setSDKInstance(AWS);

    AWSMock.mock(
      'RDS',
      'describeDBInstances',
      (
        params: AWS.RDS.Types.DescribeDBInstancesMessage,
        callback: Function,
      ) => {
        callback(null, {
          DBInstances: [],
        } as AWS.RDS.Types.DBInstanceMessage);
      },
    );

    const instance = new StopRdsDatabaseInstancesTrick();
    const stateObject: StopRdsDatabaseInstancesState = [];
    const listr = await instance.getCurrentState(
      task,
      { resourceTagMappings: [] } as TrickContext,
      stateObject,
      {
        dryRun: false,
      },
    );

    expect(listr.tasks.length).toBe(0);

    AWSMock.restore('RDS');
  });

  it('returns an empty Listr if DBInstances was not returned by AWS', async () => {
    AWSMock.setSDKInstance(AWS);

    AWSMock.mock(
      'RDS',
      'describeDBInstances',
      (
        params: AWS.RDS.Types.DescribeDBInstancesMessage,
        callback: Function,
      ) => {
        callback(null, {} as AWS.RDS.Types.DBInstanceMessage);
      },
    );

    const instance = new StopRdsDatabaseInstancesTrick();
    const stateObject: StopRdsDatabaseInstancesState = [];
    const listr = await instance.getCurrentState(
      task,
      { resourceTagMappings: [] } as TrickContext,
      stateObject,
      {
        dryRun: false,
      },
    );

    expect(listr.tasks.length).toBe(0);

    AWSMock.restore('RDS');
  });

  it('errors if DBInstanceIdentifier was not returned by AWS', async () => {
    AWSMock.setSDKInstance(AWS);

    AWSMock.mock(
      'RDS',
      'describeDBInstances',
      (
        params: AWS.RDS.Types.DescribeDBInstancesMessage,
        callback: Function,
      ) => {
        callback(null, {
          DBInstances: [{ DBInstanceStatus: 'available' }],
        } as AWS.RDS.Types.DBInstanceMessage);
      },
    );

    const instance = new StopRdsDatabaseInstancesTrick();
    const stateObject: StopRdsDatabaseInstancesState = [];
    const listr = await instance.getCurrentState(
      task,
      { resourceTagMappings: [] } as TrickContext,
      stateObject,
      {
        dryRun: false,
      },
    );

    await listr.run();

    expect(listr.err).toStrictEqual([
      expect.objectContaining({
        errors: [
          expect.objectContaining({
            message: expect.stringMatching(/DBInstanceIdentifier is missing/gi),
          }),
        ],
      }),
    ]);

    AWSMock.restore('RDS');
  });

  it('errors if DBInstanceStatus was not returned by AWS', async () => {
    AWSMock.setSDKInstance(AWS);

    AWSMock.mock(
      'RDS',
      'describeDBInstances',
      (
        params: AWS.RDS.Types.DescribeDBInstancesMessage,
        callback: Function,
      ) => {
        callback(null, {
          DBInstances: [{ DBInstanceIdentifier: 'foo' }],
        } as AWS.RDS.Types.DBInstanceMessage);
      },
    );

    const instance = new StopRdsDatabaseInstancesTrick();
    const stateObject: StopRdsDatabaseInstancesState = [];
    const listr = await instance.getCurrentState(
      task,
      { resourceTagMappings: [] } as TrickContext,
      stateObject,
      {
        dryRun: false,
      },
    );

    await listr.run();

    expect(listr.err).toStrictEqual([
      expect.objectContaining({
        errors: [
          expect.objectContaining({
            message: expect.stringMatching(/DBInstanceStatus is missing/gi),
          }),
        ],
      }),
    ]);

    AWSMock.restore('RDS');
  });

  it('generates state object for available RDS instances', async () => {
    AWSMock.setSDKInstance(AWS);

    AWSMock.mock(
      'RDS',
      'describeDBInstances',
      (
        params: AWS.RDS.Types.DescribeDBInstancesMessage,
        callback: Function,
      ) => {
        callback(null, {
          DBInstances: [
            {
              DBInstanceArn: 'aws:rds:db/bar',
              DBInstanceIdentifier: 'bar',
              DBInstanceStatus: 'available',
            },
          ],
        } as AWS.RDS.Types.DBInstanceMessage);
      },
    );

    const instance = new StopRdsDatabaseInstancesTrick();
    const stateObject: StopRdsDatabaseInstancesState = [];
    const listr = await instance.getCurrentState(
      task,
      {
        resourceTagMappings: [{ ResourceARN: 'aws:rds:db/bar' }],
      } as TrickContext,
      stateObject,
      {
        dryRun: false,
      },
    );

    await listr.run({});

    expect(stateObject).toStrictEqual(
      expect.objectContaining([
        {
          identifier: 'bar',
          status: 'available',
        } as RdsDatabaseState,
      ]),
    );

    AWSMock.restore('RDS');
  });

  it('generates state object for tagged resources', async () => {
    AWSMock.setSDKInstance(AWS);

    AWSMock.mock(
      'RDS',
      'describeDBInstances',
      (
        params: AWS.RDS.Types.DescribeDBInstancesMessage,
        callback: Function,
      ) => {
        callback(null, {
          DBInstances: [
            {
              DBInstanceArn: 'arn:rds:db/foo',
              DBInstanceIdentifier: 'foo',
              DBInstanceStatus: 'available',
            },
            {
              DBInstanceArn: 'arn:rds:db/bar',
              DBInstanceIdentifier: 'bar',
              DBInstanceStatus: 'available',
            },
          ],
        } as AWS.RDS.Types.DBInstanceMessage);
      },
    );

    const instance = new StopRdsDatabaseInstancesTrick();
    const stateObject: StopRdsDatabaseInstancesState = [];
    const listr = await instance.getCurrentState(
      task,
      {
        resourceTagMappings: [{ ResourceARN: 'arn:rds:db/bar' }],
      } as TrickContext,
      stateObject,
      {
        dryRun: false,
      },
    );

    await listr.run({});

    expect(stateObject.length).toBe(1);
    expect(stateObject).toStrictEqual(
      expect.objectContaining([
        {
          identifier: 'bar',
          status: 'available',
        } as RdsDatabaseState,
      ]),
    );

    AWSMock.restore('RDS');
  });

  it('generates state object without instances that belong to a cluster', async () => {
    AWSMock.setSDKInstance(AWS);

    AWSMock.mock(
      'RDS',
      'describeDBInstances',
      (
        params: AWS.RDS.Types.DescribeDBInstancesMessage,
        callback: Function,
      ) => {
        callback(null, {
          DBInstances: [
            {
              DBInstanceArn: 'aws:rds:db/foo',
              DBInstanceIdentifier: 'foo',
              DBInstanceStatus: 'available',
            },
            {
              DBInstanceArn: 'aws:rds:db/zoo',
              DBInstanceIdentifier: 'zoo',
              DBInstanceStatus: 'available',
              DBClusterIdentifier: 'qux',
            },
          ],
        } as AWS.RDS.Types.DBInstanceMessage);
      },
    );

    const instance = new StopRdsDatabaseInstancesTrick();
    const stateObject: StopRdsDatabaseInstancesState = [];
    const listr = await instance.getCurrentState(
      task,
      {
        resourceTagMappings: [{ ResourceARN: 'aws:rds:db/foo' }],
      } as TrickContext,
      stateObject,
      {
        dryRun: false,
      },
    );

    await listr.run({});

    expect(stateObject.length).toBe(1);
    expect(stateObject).toStrictEqual(
      expect.objectContaining([
        {
          identifier: 'foo',
          status: 'available',
        } as RdsDatabaseState,
      ]),
    );

    AWSMock.restore('RDS');
  });

  it('generates state object when database is not available', async () => {
    AWSMock.setSDKInstance(AWS);

    AWSMock.mock(
      'RDS',
      'describeDBInstances',
      (
        params: AWS.RDS.Types.DescribeDBInstancesMessage,
        callback: Function,
      ) => {
        callback(null, {
          DBInstances: [
            {
              DBInstanceArn: 'aws:rds:db/foo',
              DBInstanceIdentifier: 'foo',
              DBInstanceStatus: 'stopped',
            },
          ],
        } as AWS.RDS.Types.DBInstanceMessage);
      },
    );

    const instance = new StopRdsDatabaseInstancesTrick();
    const stateObject: StopRdsDatabaseInstancesState = [];
    const listr = await instance.getCurrentState(
      task,
      {
        resourceTagMappings: [{ ResourceARN: 'aws:rds:db/foo' }],
      } as TrickContext,
      stateObject,
      {
        dryRun: false,
      },
    );

    await listr.run({});

    expect(stateObject.pop()).toMatchObject({
      identifier: 'foo',
      status: 'stopped',
    } as RdsDatabaseState);

    AWSMock.restore('RDS');
  });

  it('conserves available RDS database instances', async () => {
    AWSMock.setSDKInstance(AWS);

    const stopDBInstanceSpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback(null, {});
      });
    AWSMock.mock('RDS', 'stopDBInstance', stopDBInstanceSpy);

    const instance = new StopRdsDatabaseInstancesTrick();
    const stateObject: StopRdsDatabaseInstancesState = [
      {
        identifier: 'foo',
        status: 'available',
      },
    ];
    const conserveListr = await instance.conserve(task, stateObject, {
      dryRun: false,
    });

    await conserveListr.run({});

    expect(stopDBInstanceSpy).toBeCalledWith(
      expect.objectContaining({
        DBInstanceIdentifier: 'foo',
      }),
      expect.anything(),
    );

    AWSMock.restore('RDS');
  });

  it('skips conserve if no databases are found', async () => {
    const instance = new StopRdsDatabaseInstancesTrick();
    const stateObject: StopRdsDatabaseInstancesState = [];

    await instance.conserve(task, stateObject, {
      dryRun: false,
    });
    expect(task.skip).toBeCalledWith(expect.any(String));
  });

  it('skips conserve for database if status is not available', async () => {
    AWSMock.setSDKInstance(AWS);

    const stopDBInstanceSpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback(null, {});
      });
    AWSMock.mock('RDS', 'stopDBInstance', stopDBInstanceSpy);

    const instance = new StopRdsDatabaseInstancesTrick();
    const stateObject: StopRdsDatabaseInstancesState = [
      {
        identifier: 'foo',
        status: 'stopped',
      },
    ];

    const conserveListr = await instance.conserve(task, stateObject, {
      dryRun: false,
    });

    await conserveListr.run({});

    expect(stopDBInstanceSpy).not.toBeCalled();

    AWSMock.restore('RDS');
  });

  it('skips conserve for database if dry-run option is enabled', async () => {
    AWSMock.setSDKInstance(AWS);

    const stopDBInstanceSpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback(null, {});
      });
    AWSMock.mock('RDS', 'stopDBInstance', stopDBInstanceSpy);

    const instance = new StopRdsDatabaseInstancesTrick();
    const stateObject: StopRdsDatabaseInstancesState = [
      {
        identifier: 'foo',
        status: 'available',
      },
    ];

    const conserveListr = await instance.conserve(task, stateObject, {
      dryRun: true,
    });

    await conserveListr.run({});

    expect(stopDBInstanceSpy).not.toBeCalled();

    AWSMock.restore('RDS');
  });

  it('restores stopped RDS database instance', async () => {
    AWSMock.setSDKInstance(AWS);

    const startDBInstanceSpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback(null, {});
      });
    AWSMock.mock('RDS', 'startDBInstance', startDBInstanceSpy);

    const instance = new StopRdsDatabaseInstancesTrick();
    const stateObject: StopRdsDatabaseInstancesState = [
      {
        identifier: 'foo',
        status: 'available',
      },
    ];
    const restoreListr = await instance.restore(task, stateObject, {
      dryRun: false,
    });

    await restoreListr.run({});

    expect(startDBInstanceSpy).toBeCalledWith(
      expect.objectContaining({
        DBInstanceIdentifier: 'foo',
      }),
      expect.anything(),
    );

    AWSMock.restore('RDS');
  });

  it('skips restore if no databases were conserved', async () => {
    const instance = new StopRdsDatabaseInstancesTrick();
    const stateObject: StopRdsDatabaseInstancesState = [];

    await instance.restore(task, stateObject, {
      dryRun: false,
    });
    expect(task.skip).toBeCalledWith(expect.any(String));
  });

  it('skips restore for database if status was not "available"', async () => {
    AWSMock.setSDKInstance(AWS);

    const startDBInstanceSpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback(null, {});
      });
    AWSMock.mock('RDS', 'startDBInstance', startDBInstanceSpy);

    const instance = new StopRdsDatabaseInstancesTrick();
    const stateObject: StopRdsDatabaseInstancesState = [
      {
        identifier: 'foo',
        status: 'stopped',
      },
    ];

    const restoreListr = await instance.restore(task, stateObject, {
      dryRun: false,
    });

    await restoreListr.run({});

    expect(startDBInstanceSpy).not.toBeCalled();

    AWSMock.restore('RDS');
  });

  it('skips restore for database if actual current status was not available', async () => {
    AWSMock.setSDKInstance(AWS);

    const startDBInstanceSpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback({ code: 'InvalidDBInstanceState' }, null);
      });
    AWSMock.mock('RDS', 'startDBInstance', startDBInstanceSpy);

    const instance = new StopRdsDatabaseInstancesTrick();
    const stateObject: StopRdsDatabaseInstancesState = [
      {
        identifier: 'foo',
        status: 'available',
      },
    ];

    const restoreListr = await instance.restore(task, stateObject, {
      dryRun: false,
    });

    await restoreListr.run({});

    expect(startDBInstanceSpy).toBeCalled();

    AWSMock.restore('RDS');
  });

  it('errors when restoring database if AWS command fails', async () => {
    AWSMock.setSDKInstance(AWS);

    const startDBInstanceSpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback({ code: 'SomethingBad' }, null);
      });
    AWSMock.mock('RDS', 'startDBInstance', startDBInstanceSpy);

    const instance = new StopRdsDatabaseInstancesTrick();
    const stateObject: StopRdsDatabaseInstancesState = [
      {
        identifier: 'foo',
        status: 'available',
      },
    ];

    const restoreListr = await instance.restore(task, stateObject, {
      dryRun: false,
    });

    await restoreListr.run();

    expect(restoreListr.err).toStrictEqual([
      expect.objectContaining({
        errors: [expect.any(Object)],
      }),
    ]);

    expect(startDBInstanceSpy).toBeCalled();

    AWSMock.restore('RDS');
  });

  it('skips restore for database if status is not provided in state', async () => {
    AWSMock.setSDKInstance(AWS);

    const startDBInstanceSpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback(null, {});
      });
    AWSMock.mock('RDS', 'startDBInstance', startDBInstanceSpy);

    const instance = new StopRdsDatabaseInstancesTrick();
    const stateObject = JSON.parse(
      `[{"name": "foo"}]`,
    ) as StopRdsDatabaseInstancesState;

    const restoreListr = await instance.restore(task, stateObject, {
      dryRun: false,
    });

    await restoreListr.run({});

    expect(startDBInstanceSpy).not.toBeCalled();

    AWSMock.restore('RDS');
  });

  it('skips restore for database if dry-run option is enabled', async () => {
    AWSMock.setSDKInstance(AWS);

    const startDBInstanceSpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback(null, {});
      });
    AWSMock.mock('RDS', 'startDBInstance', startDBInstanceSpy);

    const instance = new StopRdsDatabaseInstancesTrick();
    const stateObject: StopRdsDatabaseInstancesState = [
      {
        identifier: 'foo',
        status: 'available',
      },
    ];

    const restoreListr = await instance.restore(task, stateObject, {
      dryRun: true,
    });

    await restoreListr.run({});

    expect(startDBInstanceSpy).not.toBeCalled();

    AWSMock.restore('RDS');
  });
});
