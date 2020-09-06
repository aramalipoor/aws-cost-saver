import URLParse from 'url-parse';
import { StorageInterface } from '../interfaces/storage.interface';

import { LocalStorage } from './local.storage';
import { S3Storage } from './s3.storage';

export class StorageResolver {
  private registry: StorageInterface[] = [];

  public static initialize(): StorageResolver {
    const registry = new StorageResolver();

    registry.register(new LocalStorage(), new S3Storage());

    return registry;
  }

  register(...trick: StorageInterface[]): void {
    this.registry.push(...trick);
  }

  resolveByUri(uri: string): StorageInterface {
    const { protocol } = URLParse.extractProtocol(uri);

    if (!protocol) {
      return this.resolveByProtocol(LocalStorage.protocol);
    }

    for (const storage of this.registry) {
      if (storage.getProtocol() === protocol) {
        return storage;
      }
    }

    throw new Error(`storage protocol ${protocol} is not supported`);
  }

  resolveByProtocol(protocol: string): StorageInterface {
    for (const storage of this.registry) {
      if (storage.getProtocol() === protocol) {
        return storage;
      }
    }

    throw new Error(`storage protocol ${protocol} is not supported`);
  }
}
