import AWS from 'aws-sdk';

export type NatGatewayRouteState = {
  routeTableId: string;
  destinationCidr?: string;
  destinationIpv6Cidr?: string;
  destinationPrefixListId?: string;
};

export type NatGatewayState = {
  id: string;
  vpcId: string;
  subnetId: string;
  state: AWS.EC2.NatGatewayState;
  allocationIds: string[];
  routes: NatGatewayRouteState[];
  tags: AWS.EC2.TagList;
};
