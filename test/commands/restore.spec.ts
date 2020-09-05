import AWS from 'aws-sdk';
import AWSMock from 'aws-sdk-mock';
import { Config } from '@oclif/config';
import { mockProcessStdout } from 'jest-mock-process';

jest.mock('fs');
import fs from 'fs';
jest.mock('../../src/configure-aws');
import { configureAWS } from '../../src/configure-aws';

import Restore from '../../src/commands/restore';

async function runRestore(argv: string[]) {
  const config = new Config({ root: '../../src', ignoreManifest: true });
  config.bin = 'test';
  await Restore.run(argv, config);
}

beforeAll(async done => {
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

describe('conserve', () => {
  mockProcessStdout();

  it('restores resources from state-file', async () => {
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
