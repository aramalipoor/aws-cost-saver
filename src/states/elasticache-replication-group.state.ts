import AWS from 'aws-sdk';

export type ElasticacheReplicationGroupState = {
  id: string;
  status: string;
  snapshotName: string;
  createParams: AWS.ElastiCache.CreateReplicationGroupMessage;
};
