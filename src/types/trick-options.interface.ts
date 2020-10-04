import { TagFilterList } from 'aws-sdk/clients/resourcegroupstaggingapi';

export interface TrickOptionsInterface {
  dryRun: boolean;
  tags?: TagFilterList;
}
