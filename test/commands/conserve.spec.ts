import AWS from 'aws-sdk';
import AWSMock from 'aws-sdk-mock';
import { Config } from '@oclif/config';

import { mockSpecificMethods } from '../util';

jest.mock('fs');
import fs from 'fs';
jest.mock('inquirer');
import inquirer from 'inquirer';
jest.mock('../../src/configure-aws');
import { configureAWS } from '../../src/configure-aws';

import Conserve from '../../src/commands/conserve';
import { StopRdsDatabaseInstancesTrick } from '../../src/tricks/stop-rds-database-instances.trick';
import { DecreaseDynamoDBProvisionedRcuWcuTrick } from '../../src/tricks/decrease-dynamodb-provisioned-rcu-wcu.trick';
import { ShutdownEC2InstancesTrick } from '../../src/tricks/shutdown-ec2-instances.trick';

const MockedConserve = mockSpecificMethods(Conserve, 'log');
const mockedLog = MockedConserve.prototype.log;

async function runConserve(argv: string[]) {
  const config = new Config({ root: '../../src', ignoreManifest: true });
  config.bin = 'test';
  await MockedConserve.run(argv, config);
}

beforeAll(async done => {
  Conserve.tricksEnabledByDefault = [
    StopRdsDatabaseInstancesTrick.machineName,
    DecreaseDynamoDBProvisionedRcuWcuTrick.machineName,
  ];
  Conserve.tricksDisabledByDefault = [ShutdownEC2InstancesTrick.machineName];

  done();
});

beforeEach(async () => {
  jest.clearAllMocks();

  (configureAWS as jest.Mock).mockImplementation(() => {
    return Promise.resolve({
      region: 'eu-central-1',
      credentials: {},
    } as AWS.Config);
  });
});

describe('conserve', () => {
  it('ignores default tricks', async () => {
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

    const updateTableSpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback(null, {});
      });

    AWSMock.mock('DynamoDB', 'updateTable', updateTableSpy);

    await runConserve([
      '--no-default-tricks',
      '-u',
      'decrease-dynamodb-provisioned-rcu-wcu',
      '-n',
    ]);

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

  it('writes to state-file', async () => {
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

    const updateTableSpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback(null, {});
      });

    AWSMock.mock('DynamoDB', 'updateTable', updateTableSpy);

    jest.spyOn(fs, 'existsSync').mockReturnValueOnce(false);

    await runConserve([
      '--no-default-tricks',
      '-u',
      'decrease-dynamodb-provisioned-rcu-wcu',
    ]);

    expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      'aws-cost-saver.json',
      JSON.stringify(
        {
          'decrease-dynamodb-provisioned-rcu-wcu': [
            {
              name: 'foo',
              provisionedThroughput: true,
              rcu: 17,
              wcu: 15,
            },
          ],
        },
        null,
        2,
      ),
      expect.any(String),
    );

    AWSMock.restore('DynamoDB');
  });

  it('partially writes state-file if some tasks fail to conserve', async () => {
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

    AWSMock.mock(
      'RDS',
      'describeDBInstances',
      (
        params: AWS.RDS.Types.DescribeDBInstancesMessage,
        callback: Function,
      ) => {
        callback(null, {
          DBInstances: [
            { DBInstanceIdentifier: 'bar', DBInstanceStatus: 'available' },
          ],
        } as AWS.RDS.Types.DBInstanceMessage);
      },
    );

    const updateTableSpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback(new Error(`Failed ddb update`));
      });
    const stopDBInstanceSpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback(null, {});
      });

    AWSMock.mock('DynamoDB', 'updateTable', updateTableSpy);
    AWSMock.mock('RDS', 'stopDBInstance', stopDBInstanceSpy);

    jest.spyOn(fs, 'existsSync').mockReturnValueOnce(false);

    await runConserve([
      '--no-default-tricks',
      '-u',
      'decrease-dynamodb-provisioned-rcu-wcu',
      '-u',
      'stop-rds-database-instances',
    ]);

    expect(mockedLog).toHaveBeenCalledWith(
      expect.stringMatching(/partially conserved/gi),
    );
    expect(updateTableSpy).toHaveBeenCalledTimes(1);
    expect(stopDBInstanceSpy).toHaveBeenCalledTimes(1);
    expect(fs.writeFileSync).toHaveBeenCalledTimes(1);

    expect(fs.writeFileSync).toHaveBeenCalledWith(
      'aws-cost-saver.json',
      JSON.stringify(
        {
          'decrease-dynamodb-provisioned-rcu-wcu': [
            {
              name: 'foo',
              provisionedThroughput: true,
              rcu: 17,
              wcu: 15,
            },
          ],
          'stop-rds-database-instances': [
            {
              identifier: 'bar',
              status: 'available',
            },
          ],
        },
        null,
        2,
      ),
      expect.any(String),
    );

    AWSMock.restore('DynamoDB');
    AWSMock.restore('RDS');
  });

  it('errors if all tricks fail to conserve', async () => {
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

    AWSMock.mock(
      'RDS',
      'describeDBInstances',
      (
        params: AWS.RDS.Types.DescribeDBInstancesMessage,
        callback: Function,
      ) => {
        callback(null, {
          DBInstances: [
            { DBInstanceIdentifier: 'bar', DBInstanceStatus: 'available' },
          ],
        } as AWS.RDS.Types.DBInstanceMessage);
      },
    );

    const updateTableSpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback(new Error(`Failed ddb update`));
      });
    const stopDBInstanceSpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback(new Error(`Failed stop instance`));
      });

    AWSMock.mock('DynamoDB', 'updateTable', updateTableSpy);
    AWSMock.mock('RDS', 'stopDBInstance', stopDBInstanceSpy);

    jest.spyOn(fs, 'existsSync').mockReturnValueOnce(false);

    await runConserve([
      '--no-default-tricks',
      '-u',
      'decrease-dynamodb-provisioned-rcu-wcu',
      '-u',
      'stop-rds-database-instances',
    ]);

    expect(mockedLog).toHaveBeenCalledWith(
      expect.stringMatching(/All .* tricks failed/gi),
    );
    expect(updateTableSpy).toHaveBeenCalledTimes(1);
    expect(stopDBInstanceSpy).toHaveBeenCalledTimes(1);
    expect(fs.writeFileSync).toHaveBeenCalledTimes(1);

    expect(fs.writeFileSync).toHaveBeenCalledWith(
      'aws-cost-saver.json',
      JSON.stringify(
        {
          'decrease-dynamodb-provisioned-rcu-wcu': [
            {
              name: 'foo',
              provisionedThroughput: true,
              rcu: 17,
              wcu: 15,
            },
          ],
          'stop-rds-database-instances': [
            {
              identifier: 'bar',
              status: 'available',
            },
          ],
        },
        null,
        2,
      ),
      expect.any(String),
    );

    AWSMock.restore('DynamoDB');
    AWSMock.restore('RDS');
  });

  it('skips if dry-run option is passed', async () => {
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

    const updateTableSpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback(null, {});
      });

    AWSMock.mock('DynamoDB', 'updateTable', updateTableSpy);

    jest.spyOn(fs, 'existsSync').mockReturnValueOnce(false);

    await runConserve([
      '--dry-run',
      '--no-default-tricks',
      '-u',
      'decrease-dynamodb-provisioned-rcu-wcu',
    ]);

    expect(updateTableSpy).not.toHaveBeenCalled();
    expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      'aws-cost-saver.json',
      JSON.stringify(
        {
          'decrease-dynamodb-provisioned-rcu-wcu': [
            {
              name: 'foo',
              provisionedThroughput: true,
              rcu: 17,
              wcu: 15,
            },
          ],
        },
        null,
        2,
      ),
      expect.any(String),
    );

    AWSMock.restore('DynamoDB');
  });

  it('ignores a specific trick', async () => {
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

    const updateTableSpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback(null, {});
      });

    AWSMock.mock('DynamoDB', 'updateTable', updateTableSpy);

    jest.spyOn(fs, 'existsSync').mockReturnValueOnce(false);

    await runConserve([
      '--ignore-trick',
      'decrease-dynamodb-provisioned-rcu-wcu',
    ]);

    expect(updateTableSpy).not.toHaveBeenCalled();

    expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      'aws-cost-saver.json',
      JSON.stringify(
        {
          'stop-rds-database-instances': [],
        },
        null,
        2,
      ),
      expect.any(String),
    );

    AWSMock.restore('DynamoDB');
  });

  it('fails if trick name is invalid', async () => {
    AWSMock.setSDKInstance(AWS);

    Conserve.tricksEnabledByDefault = [
      StopRdsDatabaseInstancesTrick.machineName,
      DecreaseDynamoDBProvisionedRcuWcuTrick.machineName,
    ];

    const listTablesSpy = jest.fn();
    const describeDBInstancesSpy = jest.fn();

    AWSMock.mock('DynamoDB', 'listTables', listTablesSpy);
    AWSMock.mock('RDS', 'describeDBInstances', describeDBInstancesSpy);

    await expect(async () =>
      runConserve(['-n', '--use-trick', 'bla-blah']),
    ).rejects.toThrow('TrickNotFound');

    expect(listTablesSpy).not.toHaveBeenCalled();
    expect(describeDBInstancesSpy).not.toHaveBeenCalled();

    AWSMock.restore('DynamoDB');
    AWSMock.restore('RDS');
  });

  it('does not write to state-file if user chooses no', async () => {
    AWSMock.setSDKInstance(AWS);

    const listTablesSpy = jest.fn();

    AWSMock.mock('DynamoDB', 'listTables', listTablesSpy);

    jest.spyOn(fs, 'existsSync').mockReturnValueOnce(true);
    jest.spyOn(inquirer, 'prompt').mockReturnValueOnce({
      stateFileOverwrite: false,
    } as any);

    await expect(async () =>
      runConserve([
        '--no-default-tricks',
        '-u',
        'decrease-dynamodb-provisioned-rcu-wcu',
      ]),
    ).rejects.toThrow('AbortedByUser');

    expect(listTablesSpy).not.toHaveBeenCalled();
    expect(fs.writeFileSync).not.toHaveBeenCalled();

    AWSMock.restore('DynamoDB');
  });

  it('overwrites state-file if user chooses yes', async () => {
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

    jest.spyOn(fs, 'existsSync').mockReturnValueOnce(true);
    jest.spyOn(inquirer, 'prompt').mockReturnValueOnce({
      stateFileOverwrite: true,
    } as any);

    await runConserve([
      '--dry-run',
      '--no-default-tricks',
      '-u',
      'decrease-dynamodb-provisioned-rcu-wcu',
    ]);

    expect(fs.writeFileSync).toHaveBeenCalled();

    AWSMock.restore('DynamoDB');
  });
});
