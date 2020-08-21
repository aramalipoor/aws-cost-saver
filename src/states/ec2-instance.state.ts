import AWS from 'aws-sdk';

export type EC2InstanceState = {
  id: string;
  name: string;
  state: AWS.EC2.InstanceStateName;
};
