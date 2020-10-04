import AWS from 'aws-sdk';
import AWSMock from 'aws-sdk-mock';
import nock from 'nock';

import { S3Storage } from '../../src/storage/s3.storage';

beforeAll(async done => {
  nock.disableNetConnect();
  done();
});

beforeEach(async () => {
  nock.abortPendingRequests();
  nock.cleanAll();
  jest.clearAllMocks();
});

afterEach(async () => {
  const pending = nock.pendingMocks();

  if (pending.length > 0) {
    // eslint-disable-next-line no-console
    console.log(pending);
    throw new Error(`${pending.length} mocks are pending!`);
  }
});

describe('s3.storage', () => {
  it('errors if cannot read Body from AWS response', async () => {
    AWSMock.setSDKInstance(AWS);

    const getObjectSpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback(null, {});
      });

    AWSMock.mock('S3', 'getObject', getObjectSpy);

    const storage = new S3Storage();

    await expect(async () =>
      storage.read('s3://my_bucket/some-dir/acs-state.json'),
    ).rejects.toThrowError(/could not read content/gi);

    expect(getObjectSpy).toHaveBeenCalledTimes(1);

    AWSMock.restore('S3');
  });

  it('errors if uri does not have bucket part', async () => {
    AWSMock.setSDKInstance(AWS);

    const getObjectSpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback(null, {});
      });

    AWSMock.mock('S3', 'getObject', getObjectSpy);

    const storage = new S3Storage();

    await expect(async () =>
      storage.read('s3://sample.json'),
    ).rejects.toThrowError(/is not valid/gi);

    expect(getObjectSpy).not.toHaveBeenCalled();

    AWSMock.restore('S3');
  });

  it('errors if cannot write to object', async () => {
    AWSMock.setSDKInstance(AWS);

    const putObjectSpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback(new Error(`aws s3 error`), null);
      });

    AWSMock.mock('S3', 'putObject', putObjectSpy);

    const storage = new S3Storage();

    await expect(async () =>
      storage.write('s3://bucket/dir/sample-write-error.json', 'test content'),
    ).rejects.toThrowError(/could not write/gi);

    AWSMock.restore('S3');
  });

  it('exists() returns true if object exists', async () => {
    AWSMock.setSDKInstance(AWS);

    const headObjectSpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback(null, {});
      });

    AWSMock.mock('S3', 'headObject', headObjectSpy);

    const storage = new S3Storage();

    expect(await storage.exists('s3://bucket/sample.json')).toBe(true);

    AWSMock.restore('S3');
  });

  it('exists() throws error if headObject throws unexpected errors', async () => {
    AWSMock.setSDKInstance(AWS);

    const headObjectSpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback(new Error(`internal aws error`), null);
      });

    AWSMock.mock('S3', 'headObject', headObjectSpy);

    const storage = new S3Storage();

    await expect(async () =>
      storage.exists('s3://bucket/sample.json'),
    ).rejects.toThrowError(/internal aws error/gi);

    AWSMock.restore('S3');
  });
});
