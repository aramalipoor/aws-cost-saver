import AWS from 'aws-sdk';

export type NatGatewayState = {
  id: string;
  vpcId: string;
  subnetId: string;
  allocationIds: string[];
  tags: AWS.EC2.TagList;
};
