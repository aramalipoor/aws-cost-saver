import AWS from 'aws-sdk';

export type ScalableTargetState = {
  namespace: AWS.ApplicationAutoScaling.ServiceNamespace;
  resourceId: string;
  scalableDimension: string;
  min: number;
  max: number;
};
