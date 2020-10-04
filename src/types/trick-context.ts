import AWS from 'aws-sdk';

export type TrickContext = {
  resourceTagMappings?: AWS.ResourceGroupsTaggingAPI.ResourceTagMappingList;
};
