import { ScalableTargetState } from './scalable-target.state';

export type EcsServiceState = {
  arn: string;
  desired: number;
  scalableTargets: ScalableTargetState[];
};
