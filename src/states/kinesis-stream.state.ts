import AWS from 'aws-sdk';

export type KinesisStreamState = {
  name: string;
  state?: AWS.Kinesis.StreamStatus;
  shards?: number;
};
