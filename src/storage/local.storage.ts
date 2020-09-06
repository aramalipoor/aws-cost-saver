import { writeFileSync, readFileSync, existsSync } from 'fs';

import { StorageInterface } from '../interfaces/storage.interface';

export class LocalStorage implements StorageInterface {
  static protocol = 'file:';

  getProtocol(): string {
    return LocalStorage.protocol;
  }

  async read(uri: string): Promise<string> {
    return readFileSync(LocalStorage.getPath(uri)).toString('utf-8');
  }

  async exists(uri: string): Promise<boolean> {
    return existsSync(LocalStorage.getPath(uri));
  }

  async write(uri: string, content: any): Promise<void> {
    return writeFileSync(LocalStorage.getPath(uri), content, 'utf-8');
  }

  private static getPath(uri: string): string {
    return uri.replace(/^file:\/\//gi, '');
  }
}
