import nock from 'nock';

import { StorageResolver } from '../../src/storage/storage.resolver';
import { S3Storage } from '../../src/storage/s3.storage';
import { LocalStorage } from '../../src/storage/local.storage';

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

describe('storage.resolver', () => {
  it('errors if protocol in uri is not supported', async () => {
    const resolver = StorageResolver.initialize();

    expect(() =>
      resolver.resolveByUri('ftp://some.com/dir/file.json'),
    ).toThrowError(/protocol ftp: is not supported/gi);
  });

  it('errors if protocol is not supported', async () => {
    const resolver = StorageResolver.initialize();

    expect(() => resolver.resolveByProtocol('ftp:')).toThrowError(
      /protocol ftp: is not supported/gi,
    );
  });

  it('returns correct storage based on protocol', async () => {
    const resolver = StorageResolver.initialize();
    const storage = resolver.resolveByUri('s3://something');

    expect(storage).toBeInstanceOf(S3Storage);
  });

  it('returns local storage if no protocol is defined', async () => {
    const resolver = StorageResolver.initialize();
    const storage = resolver.resolveByUri('./something.json');

    expect(storage).toBeInstanceOf(LocalStorage);
  });
});
