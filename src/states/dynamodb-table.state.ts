export type DynamoDBTableState = {
  name: string;
  provisionedThroughput?: boolean;
  rcu?: number;
  wcu?: number;
};
