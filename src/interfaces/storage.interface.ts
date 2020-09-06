export interface StorageInterface {
  getProtocol(): string;
  read(uri: string): Promise<string>;
  write(uri: string, content: Buffer | string): Promise<void>;
  exists(uri: string): Promise<boolean>;
}
