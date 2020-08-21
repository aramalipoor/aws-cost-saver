import { EcsServiceState } from './ecs-service.state';

export type EcsClusterState = {
  arn: string;
  services: EcsServiceState[];
};
