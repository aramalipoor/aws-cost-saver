import AWS from 'aws-sdk';
import chalk from 'chalk';
import figures from 'figures';
import URLParse from 'url-parse';

import { StorageInterface } from '../types/storage.interface';

export class S3Storage implements StorageInterface {
  static protocol = 's3:';

  private s3Client: AWS.S3;

  constructor() {
    this.s3Client = new AWS.S3();
  }

  getProtocol(): string {
    return S3Storage.protocol;
  }

  async read(uri: string): Promise<string> {
    const { bucket, key } = S3Storage.parseUri(uri);

    const response = await this.s3Client
      .getObject({
        Bucket: bucket,
        Key: key,
      })
      .promise();

    if (!response || !response.Body) {
      throw new Error(
        `${chalk.red(
          figures.cross,
        )} error: could not read content of ${chalk.yellow(uri)}`,
      );
    }

    return response.Body.toString('utf-8');
  }

  async exists(uri: string): Promise<boolean> {
    const { bucket, key } = S3Storage.parseUri(uri);

    try {
      await this.s3Client
        .headObject({
          Bucket: bucket,
          Key: key,
        })
        .promise();
      return true;
    } catch (error) {
      if (error.code !== 'NotFound') {
        throw error;
      }
    }

    return false;
  }

  async write(uri: string, content: any): Promise<void> {
    const { bucket, key } = S3Storage.parseUri(uri);

    try {
      await this.s3Client
        .putObject({
          Bucket: bucket,
          Key: key,
          Body: content,
        })
        .promise();
    } catch (error) {
      throw new Error(
        `${chalk.red(figures.cross)} could not write to ${chalk.yellow(
          uri,
        )}: ${chalk.red(error.toString())}`,
      );
    }
  }

  private static parseUri(uri: string): { bucket: string; key: string } {
    const result = new URLParse(uri);

    if (!result.host || !result.pathname) {
      throw new Error(
        `${chalk.red(figures.cross)} s3 path (${chalk.yellow(
          uri,
        )}) is not valid, path must be like: s3://bucket_name/my_dir/object_path.json`,
      );
    }

    return { bucket: result.host, key: result.pathname.substr(1) };
  }
}
