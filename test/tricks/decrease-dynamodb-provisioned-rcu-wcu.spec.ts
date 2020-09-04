import AWS from 'aws-sdk';
import AWSMock from 'aws-sdk-mock';
import { mockProcessStdout } from 'jest-mock-process';
import { ListrTaskWrapper } from 'listr2';

import {
  DecreaseDynamoDBProvisionedRcuWcuTrick,
  DecreaseDynamoDBProvisionedRcuWcuState,
} from '../../src/tricks/decrease-dynamodb-provisioned-rcu-wcu.trick';
import { DynamoDBTableState } from '../../src/states/dynamodb-table.state';
import { createMockTask } from '../util';

beforeAll(async done => {
  mockProcessStdout();
  done();
});

describe('decrease-dynamodb-provisioned-rcu-wcu', () => {
  let task: ListrTaskWrapper<any, any>;

  beforeEach(() => {
    task = createMockTask();
  });

  it('returns correct machine name', async () => {
    const instance = new DecreaseDynamoDBProvisionedRcuWcuTrick();
    expect(instance.getMachineName()).toBe(
      DecreaseDynamoDBProvisionedRcuWcuTrick.machineName,
    );
  });

  it('returns an empty Listr if no tables found', async () => {
    AWSMock.setSDKInstance(AWS);

    AWSMock.mock(
      'DynamoDB',
      'listTables',
      (params: AWS.DynamoDB.Types.ListTablesInput, callback: Function) => {
        callback(null, { TableNames: [] });
      },
    );

    const instance = new DecreaseDynamoDBProvisionedRcuWcuTrick();
    const stateObject: DecreaseDynamoDBProvisionedRcuWcuState = [];
    const listr = await instance.getCurrentState(task, stateObject, {
      dryRun: false,
    });

    expect(listr.tasks.length).toBe(0);

    AWSMock.restore('DynamoDB');
  });

  it('returns an empty Listr if TableNames was not returned from AWS', async () => {
    AWSMock.setSDKInstance(AWS);

    AWSMock.mock(
      'DynamoDB',
      'listTables',
      (params: AWS.DynamoDB.Types.ListTablesInput, callback: Function) => {
        callback(null, {});
      },
    );

    const instance = new DecreaseDynamoDBProvisionedRcuWcuTrick();
    const stateObject: DecreaseDynamoDBProvisionedRcuWcuState = [];
    const listr = await instance.getCurrentState(task, stateObject, {
      dryRun: false,
    });

    expect(listr.tasks.length).toBe(0);

    AWSMock.restore('DynamoDB');
  });

  it('generates state object for provisioned RCU and WCU', async () => {
    AWSMock.setSDKInstance(AWS);

    AWSMock.mock(
      'DynamoDB',
      'listTables',
      (params: AWS.DynamoDB.Types.ListTablesInput, callback: Function) => {
        callback(null, { TableNames: ['foo'] });
      },
    );

    AWSMock.mock(
      'DynamoDB',
      'describeTable',
      (params: AWS.DynamoDB.Types.DescribeTableInput, callback: Function) => {
        if (params.TableName === 'foo') {
          callback(null, {
            Table: {
              TableName: 'foo',
              ProvisionedThroughput: {
                WriteCapacityUnits: 15,
                ReadCapacityUnits: 17,
              },
            },
          } as AWS.DynamoDB.Types.DescribeTableOutput);
        } else {
          callback(new Error('Table not exists'));
        }
      },
    );

    const instance = new DecreaseDynamoDBProvisionedRcuWcuTrick();
    const stateObject: DecreaseDynamoDBProvisionedRcuWcuState = [];
    const listr = await instance.getCurrentState(task, stateObject, {
      dryRun: false,
    });

    await listr.run({});

    expect(stateObject.pop()).toMatchObject({
      name: 'foo',
      provisionedThroughput: true,
      wcu: 15,
      rcu: 17,
    } as DynamoDBTableState);

    AWSMock.restore('DynamoDB');
  });

  it('generates state object when table does not have provisioned RCU and WCU', async () => {
    AWSMock.setSDKInstance(AWS);

    AWSMock.mock(
      'DynamoDB',
      'listTables',
      (params: AWS.DynamoDB.Types.ListTablesInput, callback: Function) => {
        callback(null, { TableNames: ['foo'] });
      },
    );

    AWSMock.mock(
      'DynamoDB',
      'describeTable',
      (params: AWS.DynamoDB.Types.DescribeTableInput, callback: Function) => {
        if (params.TableName === 'foo') {
          callback(null, {
            Table: {
              TableName: 'foo',
            },
          } as AWS.DynamoDB.Types.DescribeTableOutput);
        } else {
          callback(new Error('Table not exists'));
        }
      },
    );

    const instance = new DecreaseDynamoDBProvisionedRcuWcuTrick();
    const stateObject: DecreaseDynamoDBProvisionedRcuWcuState = [];
    const listr = await instance.getCurrentState(task, stateObject, {
      dryRun: false,
    });

    await listr.run({});

    expect(stateObject.pop()).toMatchObject({
      name: 'foo',
      provisionedThroughput: false,
    } as DynamoDBTableState);

    AWSMock.restore('DynamoDB');
  });

  it('conserves provisioned RCU and WCU', async () => {
    AWSMock.setSDKInstance(AWS);

    const updateTableSpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback(null, {});
      });
    AWSMock.mock('DynamoDB', 'updateTable', updateTableSpy);

    const instance = new DecreaseDynamoDBProvisionedRcuWcuTrick();
    const stateObject: DecreaseDynamoDBProvisionedRcuWcuState = [
      {
        name: 'foo',
        provisionedThroughput: true,
        wcu: 22,
        rcu: 33,
      },
    ];
    const conserveListr = await instance.conserve(task, stateObject, {
      dryRun: false,
    });

    await conserveListr.run({});

    expect(updateTableSpy).toBeCalledWith(
      expect.objectContaining({
        TableName: 'foo',
        ProvisionedThroughput: {
          ReadCapacityUnits: 1,
          WriteCapacityUnits: 1,
        },
      }),
      expect.anything(),
    );

    AWSMock.restore('DynamoDB');
  });

  it('skips conserve if no tables are found', async () => {
    const instance = new DecreaseDynamoDBProvisionedRcuWcuTrick();
    const stateObject: DecreaseDynamoDBProvisionedRcuWcuState = [];

    await instance.conserve(task, stateObject, {
      dryRun: false,
    });
    expect(task.skip).toBeCalledWith(expect.any(String));
  });

  it('skips conserve for table if RCU and WCU is not provisioned', async () => {
    AWSMock.setSDKInstance(AWS);

    const updateTableSpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback(null, {});
      });
    AWSMock.mock('DynamoDB', 'updateTable', updateTableSpy);

    const instance = new DecreaseDynamoDBProvisionedRcuWcuTrick();
    const stateObject: DecreaseDynamoDBProvisionedRcuWcuState = [
      {
        name: 'foo',
        provisionedThroughput: false,
        rcu: 1,
        wcu: 1,
      },
    ];

    const conserveListr = await instance.conserve(task, stateObject, {
      dryRun: false,
    });

    await conserveListr.run({});

    expect(updateTableSpy).not.toBeCalled();

    AWSMock.restore('DynamoDB');
  });

  it('skips conserve for table if RCU and WCU is already at 1', async () => {
    AWSMock.setSDKInstance(AWS);

    const updateTableSpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback(null, {});
      });
    AWSMock.mock('DynamoDB', 'updateTable', updateTableSpy);

    const instance = new DecreaseDynamoDBProvisionedRcuWcuTrick();
    const stateObject: DecreaseDynamoDBProvisionedRcuWcuState = [
      {
        name: 'foo',
        provisionedThroughput: true,
        rcu: 1,
        wcu: 1,
      },
    ];

    const conserveListr = await instance.conserve(task, stateObject, {
      dryRun: false,
    });

    await conserveListr.run({});

    expect(updateTableSpy).not.toBeCalled();

    AWSMock.restore('DynamoDB');
  });

  it('skips conserve for table if dry-run option is enabled', async () => {
    AWSMock.setSDKInstance(AWS);

    const updateTableSpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback(null, {});
      });
    AWSMock.mock('DynamoDB', 'updateTable', updateTableSpy);

    const instance = new DecreaseDynamoDBProvisionedRcuWcuTrick();
    const stateObject: DecreaseDynamoDBProvisionedRcuWcuState = [
      {
        name: 'foo',
        provisionedThroughput: true,
        rcu: 10,
        wcu: 10,
      },
    ];

    const conserveListr = await instance.conserve(task, stateObject, {
      dryRun: true,
    });

    await conserveListr.run({});

    expect(updateTableSpy).not.toBeCalled();

    AWSMock.restore('DynamoDB');
  });

  it('restores provisioned RCU and WCU', async () => {
    AWSMock.setSDKInstance(AWS);

    const updateTableSpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback(null, {});
      });
    AWSMock.mock('DynamoDB', 'updateTable', updateTableSpy);

    const instance = new DecreaseDynamoDBProvisionedRcuWcuTrick();
    const stateObject: DecreaseDynamoDBProvisionedRcuWcuState = [
      {
        name: 'foo',
        provisionedThroughput: true,
        wcu: 14,
        rcu: 18,
      },
    ];
    const restoreListr = await instance.restore(task, stateObject, {
      dryRun: false,
    });

    await restoreListr.run({});

    expect(updateTableSpy).toBeCalledWith(
      expect.objectContaining({
        TableName: 'foo',
        ProvisionedThroughput: {
          ReadCapacityUnits: 18,
          WriteCapacityUnits: 14,
        },
      }),
      expect.anything(),
    );

    AWSMock.restore('DynamoDB');
  });

  it('skips restore if no tables were conserved', async () => {
    const instance = new DecreaseDynamoDBProvisionedRcuWcuTrick();
    const stateObject: DecreaseDynamoDBProvisionedRcuWcuState = [];

    await instance.restore(task, stateObject, {
      dryRun: false,
    });
    expect(task.skip).toBeCalledWith(expect.any(String));
  });

  it('skips restore for table if RCU and WCU was not provisioned', async () => {
    AWSMock.setSDKInstance(AWS);

    const updateTableSpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback(null, {});
      });
    AWSMock.mock('DynamoDB', 'updateTable', updateTableSpy);

    const instance = new DecreaseDynamoDBProvisionedRcuWcuTrick();
    const stateObject: DecreaseDynamoDBProvisionedRcuWcuState = [
      {
        name: 'foo',
        provisionedThroughput: false,
        rcu: 1,
        wcu: 1,
      },
    ];

    const restoreListr = await instance.restore(task, stateObject, {
      dryRun: false,
    });

    await restoreListr.run({});

    expect(updateTableSpy).not.toBeCalled();

    AWSMock.restore('DynamoDB');
  });

  it('restores table if RCU and WCU was already 1', async () => {
    AWSMock.setSDKInstance(AWS);

    const updateTableSpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback(null, {});
      });
    AWSMock.mock('DynamoDB', 'updateTable', updateTableSpy);

    const instance = new DecreaseDynamoDBProvisionedRcuWcuTrick();
    const stateObject: DecreaseDynamoDBProvisionedRcuWcuState = [
      {
        name: 'foo',
        provisionedThroughput: true,
        rcu: 1,
        wcu: 1,
      },
    ];

    const restoreListr = await instance.restore(task, stateObject, {
      dryRun: false,
    });

    await restoreListr.run({});

    expect(updateTableSpy).toBeCalledWith(
      expect.objectContaining({
        TableName: 'foo',
        ProvisionedThroughput: {
          ReadCapacityUnits: 1,
          WriteCapacityUnits: 1,
        },
      }),
      expect.anything(),
    );

    AWSMock.restore('DynamoDB');
  });

  it('skips restore for table if RCU and WCU is not provided in state', async () => {
    AWSMock.setSDKInstance(AWS);

    const updateTableSpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback(null, {});
      });
    AWSMock.mock('DynamoDB', 'updateTable', updateTableSpy);

    const instance = new DecreaseDynamoDBProvisionedRcuWcuTrick();
    const stateObject = JSON.parse(
      `[{"name": "foo", "provisionedThroughput": true}]`,
    ) as DecreaseDynamoDBProvisionedRcuWcuState;

    const restoreListr = await instance.restore(task, stateObject, {
      dryRun: false,
    });

    await restoreListr.run({});

    expect(updateTableSpy).not.toBeCalled();

    AWSMock.restore('DynamoDB');
  });

  it('skips restore for table if dry-run option is enabled', async () => {
    AWSMock.setSDKInstance(AWS);

    const updateTableSpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback(null, {});
      });
    AWSMock.mock('DynamoDB', 'updateTable', updateTableSpy);

    const instance = new DecreaseDynamoDBProvisionedRcuWcuTrick();
    const stateObject: DecreaseDynamoDBProvisionedRcuWcuState = [
      {
        name: 'foo',
        provisionedThroughput: true,
        rcu: 10,
        wcu: 10,
      },
    ];

    const restoreListr = await instance.restore(task, stateObject, {
      dryRun: true,
    });

    await restoreListr.run({});

    expect(updateTableSpy).not.toBeCalled();

    AWSMock.restore('DynamoDB');
  });
});
