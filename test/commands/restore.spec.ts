import AWS from 'aws-sdk';
import AWSMock from 'aws-sdk-mock';
import { Config } from '@oclif/config';
import nock from 'nock';
import { mockProcessStdout } from 'jest-mock-process';

jest.mock('fs');
import fs from 'fs';
jest.mock('../../src/util');
import { configureAWS } from '../../src/util';

import Restore from '../../src/commands/restore';

async function runRestore(argv: string[]) {
  const config = new Config({ root: '../../src', ignoreManifest: true });
  config.bin = 'test';
  await Restore.run(argv, config);
}

beforeAll(async done => {
  nock.abortPendingRequests();
  nock.cleanAll();
  nock.disableNetConnect();

  // AWSMock cannot mock waiters at the moment
  AWS.RDS.prototype.waitFor = jest.fn();

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

afterEach(async () => {
  const pending = nock.pendingMocks();

  if (pending.length > 0) {
    // eslint-disable-next-line no-console
    console.log(pending);
    throw new Error(`${pending.length} mocks are pending!`);
  }
});

describe('conserve', () => {
  mockProcessStdout();

  it('restores resources from state-file from default storage', async () => {
    AWSMock.setSDKInstance(AWS);

    const updateTableSpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback(null, {});
      });

    AWSMock.mock('DynamoDB', 'updateTable', updateTableSpy);

    AWSMock.mock(
      'DynamoDB',
      'describeTable',
      (params: AWS.DynamoDB.Types.DescribeTableInput, callback: Function) => {
        if (params.TableName === 'foo') {
          callback(null, {
            Table: {
              TableName: 'foo',
              ProvisionedThroughput: {
                WriteCapacityUnits: 1,
                ReadCapacityUnits: 1,
              },
            },
          } as AWS.DynamoDB.Types.DescribeTableOutput);
        } else {
          callback(new Error('Table not exists'));
        }
      },
    );

    jest.spyOn(fs, 'readFileSync').mockReturnValueOnce(
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
    );

    await runRestore([]);

    expect(updateTableSpy).toHaveBeenCalledTimes(1);
    expect(updateTableSpy).toBeCalledWith(
      expect.objectContaining({
        TableName: 'foo',
        ProvisionedThroughput: {
          ReadCapacityUnits: 17,
          WriteCapacityUnits: 15,
        },
      }),
      expect.anything(),
    );

    AWSMock.restore('DynamoDB');
  });

  it('restores resources from state-file from s3 storage', async () => {
    AWSMock.setSDKInstance(AWS);

    const updateTableSpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback(null, {});
      });

    AWSMock.mock('DynamoDB', 'updateTable', updateTableSpy);

    AWSMock.mock(
      'DynamoDB',
      'describeTable',
      (params: AWS.DynamoDB.Types.DescribeTableInput, callback: Function) => {
        if (params.TableName === 'foo') {
          callback(null, {
            Table: {
              TableName: 'foo',
              ProvisionedThroughput: {
                WriteCapacityUnits: 1,
                ReadCapacityUnits: 1,
              },
            },
          } as AWS.DynamoDB.Types.DescribeTableOutput);
        } else {
          callback(new Error('Table not exists'));
        }
      },
    );

    const getObjectSpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback(null, {
          Body: JSON.stringify(
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
        });
      });

    AWSMock.mock('S3', 'getObject', getObjectSpy);

    await runRestore(['-s', 's3://my_bucket/some-dir/acs-state.json']);

    expect(updateTableSpy).toHaveBeenCalledTimes(1);
    expect(updateTableSpy).toBeCalledWith(
      expect.objectContaining({
        TableName: 'foo',
        ProvisionedThroughput: {
          ReadCapacityUnits: 17,
          WriteCapacityUnits: 15,
        },
      }),
      expect.anything(),
    );

    AWSMock.restore('DynamoDB');
    AWSMock.restore('S3');
  });

  it('does nothing when in dry-run mode', async () => {
    AWSMock.setSDKInstance(AWS);

    const updateTableSpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback(null, {});
      });

    AWSMock.mock('DynamoDB', 'updateTable', updateTableSpy);

    jest.spyOn(fs, 'readFileSync').mockReturnValueOnce(
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
    );

    await runRestore(['--dry-run']);

    expect(updateTableSpy).not.toHaveBeenCalled();

    AWSMock.restore('DynamoDB');
  });

  it('partially restores if some tricks fail to restore', async () => {
    AWSMock.setSDKInstance(AWS);

    const updateTableSpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback(new Error(`Failed ddb update`));
      });
    const startDBInstanceSpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback(null, {});
      });

    AWSMock.mock(
      'DynamoDB',
      'describeTable',
      (params: AWS.DynamoDB.Types.DescribeTableInput, callback: Function) => {
        if (params.TableName === 'foo') {
          callback(null, {
            Table: {
              TableName: 'foo',
              ProvisionedThroughput: {
                WriteCapacityUnits: 1,
                ReadCapacityUnits: 1,
              },
            },
          } as AWS.DynamoDB.Types.DescribeTableOutput);
        } else {
          callback(new Error('Table not exists'));
        }
      },
    );

    AWSMock.mock('DynamoDB', 'updateTable', updateTableSpy);
    AWSMock.mock('RDS', 'startDBInstance', startDBInstanceSpy);

    jest.spyOn(fs, 'readFileSync').mockReturnValueOnce(
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
    );

    await expect(async () => runRestore([])).rejects.toThrowError(
      'RestorePartialFailure',
    );

    expect(updateTableSpy).toHaveBeenCalledTimes(1);
    expect(startDBInstanceSpy).toHaveBeenCalledTimes(1);

    AWSMock.restore('DynamoDB');
    AWSMock.restore('RDS');
  });
});
