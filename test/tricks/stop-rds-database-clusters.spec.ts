import AWS from 'aws-sdk';
import AWSMock from 'aws-sdk-mock';

import { ListrTaskWrapper } from 'listr';

import {
  StopRdsDatabaseClustersTrick,
  StopRdsDatabaseClustersState,
} from '../../src/tricks/stop-rds-database-clusters.trick';
import { RdsClusterState } from '../../src/states/rds-cluster.state';

beforeAll(async done => {
  // AWSMock cannot mock waiters at the moment
  AWS.RDS.prototype.waitFor = jest.fn().mockImplementation(() => ({
    promise: jest.fn(),
  }));

  done();
});

describe('stop-rds-database-clusters', () => {
  let task: ListrTaskWrapper;

  beforeEach(() => {
    task = {
      title: '',
      output: '',
      run: jest.fn(),
      skip: jest.fn(),
      report: jest.fn(),
    };
  });

  it('returns correct machine name', async () => {
    const instance = new StopRdsDatabaseClustersTrick();
    expect(instance.getMachineName()).toBe(
      StopRdsDatabaseClustersTrick.machineName,
    );
  });

  it('returns different title for conserve and restore commands', async () => {
    const instance = new StopRdsDatabaseClustersTrick();
    expect(instance.getConserveTitle()).not.toBe(instance.getRestoreTitle());
  });

  it('returns an empty Listr if no databases found', async () => {
    AWSMock.setSDKInstance(AWS);

    AWSMock.mock(
      'RDS',
      'describeDBClusters',
      (params: AWS.RDS.Types.DescribeDBClustersMessage, callback: Function) => {
        callback(null, {
          DBClusters: [],
        } as AWS.RDS.Types.DBClusterMessage);
      },
    );

    const instance = new StopRdsDatabaseClustersTrick();
    const stateObject: StopRdsDatabaseClustersState = [];
    const listr = await instance.getCurrentState(task, stateObject, {
      dryRun: false,
    });

    expect(listr.tasks.length).toBe(0);

    AWSMock.restore('RDS');
  });

  it('returns an empty Listr if DBClusters was not returned by AWS', async () => {
    AWSMock.setSDKInstance(AWS);

    AWSMock.mock(
      'RDS',
      'describeDBClusters',
      (params: AWS.RDS.Types.DescribeDBClustersMessage, callback: Function) => {
        callback(null, {} as AWS.RDS.Types.DBClusterMessage);
      },
    );

    const instance = new StopRdsDatabaseClustersTrick();
    const stateObject: StopRdsDatabaseClustersState = [];
    const listr = await instance.getCurrentState(task, stateObject, {
      dryRun: false,
    });

    expect(listr.tasks.length).toBe(0);

    AWSMock.restore('RDS');
  });

  it('errors if DBClusterIdentifier was not returned by AWS', async () => {
    AWSMock.setSDKInstance(AWS);

    AWSMock.mock(
      'RDS',
      'describeDBClusters',
      (params: AWS.RDS.Types.DescribeDBClustersMessage, callback: Function) => {
        callback(null, {
          DBClusters: [{ Status: 'available' }],
        } as AWS.RDS.Types.DBClusterMessage);
      },
    );

    const instance = new StopRdsDatabaseClustersTrick();
    const stateObject: StopRdsDatabaseClustersState = [];
    const listr = await instance.getCurrentState(task, stateObject, {
      dryRun: false,
    });
    listr.setRenderer('silent');

    await expect(async () => listr.run()).rejects.toMatchObject({
      errors: expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringContaining('DBClusterIdentifier is missing'),
        }),
      ]),
    });

    AWSMock.restore('RDS');
  });

  it('errors if Status was not returned by AWS', async () => {
    AWSMock.setSDKInstance(AWS);

    AWSMock.mock(
      'RDS',
      'describeDBClusters',
      (params: AWS.RDS.Types.DescribeDBClustersMessage, callback: Function) => {
        callback(null, {
          DBClusters: [{ DBClusterIdentifier: 'foo' }],
        } as AWS.RDS.Types.DBClusterMessage);
      },
    );

    const instance = new StopRdsDatabaseClustersTrick();
    const stateObject: StopRdsDatabaseClustersState = [];
    const listr = await instance.getCurrentState(task, stateObject, {
      dryRun: false,
    });
    listr.setRenderer('silent');

    await expect(async () => listr.run()).rejects.toMatchObject({
      errors: expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringContaining('Status is missing'),
        }),
      ]),
    });

    AWSMock.restore('RDS');
  });

  it('generates state object for available RDS clusters', async () => {
    AWSMock.setSDKInstance(AWS);

    AWSMock.mock(
      'RDS',
      'describeDBClusters',
      (params: AWS.RDS.Types.DescribeDBClustersMessage, callback: Function) => {
        callback(null, {
          DBClusters: [{ DBClusterIdentifier: 'foo', Status: 'available' }],
        } as AWS.RDS.Types.DBClusterMessage);
      },
    );

    const instance = new StopRdsDatabaseClustersTrick();
    const stateObject: StopRdsDatabaseClustersState = [];
    const listr = await instance.getCurrentState(task, stateObject, {
      dryRun: false,
    });

    listr.setRenderer('silent');
    await listr.run({});

    expect(stateObject).toStrictEqual(
      expect.objectContaining([
        {
          identifier: 'foo',
          status: 'available',
        } as RdsClusterState,
      ]),
    );

    AWSMock.restore('RDS');
  });

  it('generates state object when database is not available', async () => {
    AWSMock.setSDKInstance(AWS);

    AWSMock.mock(
      'RDS',
      'describeDBClusters',
      (params: AWS.RDS.Types.DescribeDBClustersMessage, callback: Function) => {
        callback(null, {
          DBClusters: [{ DBClusterIdentifier: 'foo', Status: 'stopped' }],
        } as AWS.RDS.Types.DBClusterMessage);
      },
    );

    const instance = new StopRdsDatabaseClustersTrick();
    const stateObject: StopRdsDatabaseClustersState = [];
    const listr = await instance.getCurrentState(task, stateObject, {
      dryRun: false,
    });

    listr.setRenderer('silent');
    await listr.run({});

    expect(stateObject.pop()).toMatchObject({
      identifier: 'foo',
      status: 'stopped',
    } as RdsClusterState);

    AWSMock.restore('RDS');
  });

  it('conserves available RDS database clusters', async () => {
    AWSMock.setSDKInstance(AWS);

    const stopDBClusterSpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback(null, {});
      });
    AWSMock.mock('RDS', 'stopDBCluster', stopDBClusterSpy);

    const instance = new StopRdsDatabaseClustersTrick();
    const stateObject: StopRdsDatabaseClustersState = [
      {
        identifier: 'foo',
        status: 'available',
      },
    ];
    const conserveListr = await instance.conserve(task, stateObject, {
      dryRun: false,
    });
    conserveListr.setRenderer('silent');
    await conserveListr.run({});

    expect(stopDBClusterSpy).toBeCalledWith(
      expect.objectContaining({
        DBClusterIdentifier: 'foo',
      }),
      expect.anything(),
    );

    AWSMock.restore('RDS');
  });

  it('skips conserve if no databases are found', async () => {
    const instance = new StopRdsDatabaseClustersTrick();
    const stateObject: StopRdsDatabaseClustersState = [];

    await instance.conserve(task, stateObject, {
      dryRun: false,
    });
    expect(task.skip).toBeCalledWith(expect.any(String));
  });

  it('skips conserve for database if status is not available', async () => {
    AWSMock.setSDKInstance(AWS);

    const stopDBClusterSpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback(null, {});
      });
    AWSMock.mock('RDS', 'stopDBCluster', stopDBClusterSpy);

    const instance = new StopRdsDatabaseClustersTrick();
    const stateObject: StopRdsDatabaseClustersState = [
      {
        identifier: 'foo',
        status: 'stopped',
      },
    ];

    const conserveListr = await instance.conserve(task, stateObject, {
      dryRun: false,
    });
    conserveListr.setRenderer('silent');
    await conserveListr.run({});

    expect(stopDBClusterSpy).not.toBeCalled();

    AWSMock.restore('RDS');
  });

  it('skips conserve for database if dry-run option is enabled', async () => {
    AWSMock.setSDKInstance(AWS);

    const stopDBClusterSpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback(null, {});
      });
    AWSMock.mock('RDS', 'stopDBCluster', stopDBClusterSpy);

    const instance = new StopRdsDatabaseClustersTrick();
    const stateObject: StopRdsDatabaseClustersState = [
      {
        identifier: 'foo',
        status: 'available',
      },
    ];

    const conserveListr = await instance.conserve(task, stateObject, {
      dryRun: true,
    });
    conserveListr.setRenderer('silent');
    await conserveListr.run({});

    expect(stopDBClusterSpy).not.toBeCalled();

    AWSMock.restore('RDS');
  });

  it('restores stopped RDS database instance', async () => {
    AWSMock.setSDKInstance(AWS);

    const startDBClusterSpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback(null, {});
      });
    AWSMock.mock('RDS', 'startDBCluster', startDBClusterSpy);

    const instance = new StopRdsDatabaseClustersTrick();
    const stateObject: StopRdsDatabaseClustersState = [
      {
        identifier: 'foo',
        status: 'available',
      },
    ];
    const restoreListr = await instance.restore(task, stateObject, {
      dryRun: false,
    });
    restoreListr.setRenderer('silent');
    await restoreListr.run({});

    expect(startDBClusterSpy).toBeCalledWith(
      expect.objectContaining({
        DBClusterIdentifier: 'foo',
      }),
      expect.anything(),
    );

    AWSMock.restore('RDS');
  });

  it('skips restore if no databases were conserved', async () => {
    const instance = new StopRdsDatabaseClustersTrick();
    const stateObject: StopRdsDatabaseClustersState = [];

    await instance.restore(task, stateObject, {
      dryRun: false,
    });
    expect(task.skip).toBeCalledWith(expect.any(String));
  });

  it('skips restore for database if status was not "available"', async () => {
    AWSMock.setSDKInstance(AWS);

    const startDBClusterSpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback(null, {});
      });
    AWSMock.mock('RDS', 'startDBCluster', startDBClusterSpy);

    const instance = new StopRdsDatabaseClustersTrick();
    const stateObject: StopRdsDatabaseClustersState = [
      {
        identifier: 'foo',
        status: 'stopped',
      },
    ];

    const restoreListr = await instance.restore(task, stateObject, {
      dryRun: false,
    });
    restoreListr.setRenderer('silent');
    await restoreListr.run({});

    expect(startDBClusterSpy).not.toBeCalled();

    AWSMock.restore('RDS');
  });

  it('skips restore for database if actual current status was not available', async () => {
    AWSMock.setSDKInstance(AWS);

    const startDBClusterSpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback({ code: 'InvalidDBInstanceState' }, null);
      });
    AWSMock.mock('RDS', 'startDBCluster', startDBClusterSpy);

    const instance = new StopRdsDatabaseClustersTrick();
    const stateObject: StopRdsDatabaseClustersState = [
      {
        identifier: 'foo',
        status: 'available',
      },
    ];

    const restoreListr = await instance.restore(task, stateObject, {
      dryRun: false,
    });
    restoreListr.setRenderer('silent');
    await restoreListr.run({});

    expect(startDBClusterSpy).toBeCalled();

    AWSMock.restore('RDS');
  });

  it('errors when restoring database if AWS command fails', async () => {
    AWSMock.setSDKInstance(AWS);

    const startDBClusterSpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback({ code: 'SomethingBad' }, null);
      });
    AWSMock.mock('RDS', 'startDBCluster', startDBClusterSpy);

    const instance = new StopRdsDatabaseClustersTrick();
    const stateObject: StopRdsDatabaseClustersState = [
      {
        identifier: 'foo',
        status: 'available',
      },
    ];

    const restoreListr = await instance.restore(task, stateObject, {
      dryRun: false,
    });
    restoreListr.setRenderer('silent');

    await expect(async () => restoreListr.run()).rejects.toThrow();

    expect(startDBClusterSpy).toBeCalled();

    AWSMock.restore('RDS');
  });

  it('skips restore for database if status is not provided in state', async () => {
    AWSMock.setSDKInstance(AWS);

    const startDBClusterSpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback(null, {});
      });
    AWSMock.mock('RDS', 'startDBCluster', startDBClusterSpy);

    const instance = new StopRdsDatabaseClustersTrick();
    const stateObject = JSON.parse(
      `[{"name": "foo"}]`,
    ) as StopRdsDatabaseClustersState;

    const restoreListr = await instance.restore(task, stateObject, {
      dryRun: false,
    });
    restoreListr.setRenderer('silent');
    await restoreListr.run({});

    expect(startDBClusterSpy).not.toBeCalled();

    AWSMock.restore('RDS');
  });

  it('skips restore for database if dry-run option is enabled', async () => {
    AWSMock.setSDKInstance(AWS);

    const startDBClusterSpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback(null, {});
      });
    AWSMock.mock('RDS', 'startDBCluster', startDBClusterSpy);

    const instance = new StopRdsDatabaseClustersTrick();
    const stateObject: StopRdsDatabaseClustersState = [
      {
        identifier: 'foo',
        status: 'available',
      },
    ];

    const restoreListr = await instance.restore(task, stateObject, {
      dryRun: true,
    });
    restoreListr.setRenderer('silent');
    await restoreListr.run({});

    expect(startDBClusterSpy).not.toBeCalled();

    AWSMock.restore('RDS');
  });
});