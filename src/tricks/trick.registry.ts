import { TrickInterface } from '../types/trick.interface';

import { StopFargateEcsServicesTrick } from './stop-fargate-ecs-services.trick';
import { StopRdsDatabaseInstancesTrick } from './stop-rds-database-instances.trick';
import { ShutdownEC2InstancesTrick } from './shutdown-ec2-instances.trick';
import { DecreaseDynamoDBProvisionedRcuWcuTrick } from './decrease-dynamodb-provisioned-rcu-wcu.trick';
import { RemoveNatGatewaysTrick } from './remove-nat-gateways.trick';
import { SnapshotRemoveElasticacheRedisTrick } from './snapshot-remove-elasticache-redis.trick';
import { DecreaseKinesisStreamsShardsTrick } from './decrease-kinesis-streams-shards.trick';
import { StopRdsDatabaseClustersTrick } from './stop-rds-database-clusters.trick';
import { ScaledownAutoScalingGroupsTrick } from './scaledown-auto-scaling-groups.trick';
import { SuspendAutoScalingGroupsTrick } from './suspend-auto-scaling-groups.trick';

export class TrickRegistry {
  private registry: TrickInterface<any>[] = [];

  public static initialize(): TrickRegistry {
    const registry = new TrickRegistry();

    registry.register(
      new StopFargateEcsServicesTrick(),
      new StopRdsDatabaseInstancesTrick(),
      new ShutdownEC2InstancesTrick(),
      new DecreaseDynamoDBProvisionedRcuWcuTrick(),
      new RemoveNatGatewaysTrick(),
      new SnapshotRemoveElasticacheRedisTrick(),
      new DecreaseKinesisStreamsShardsTrick(),
      new StopRdsDatabaseClustersTrick(),
      new ScaledownAutoScalingGroupsTrick(),
      new SuspendAutoScalingGroupsTrick(),
    );

    return registry;
  }

  register(...trick: TrickInterface<any>[]): void {
    this.registry.push(...trick);
  }

  all(): TrickInterface<any>[] {
    return this.registry;
  }
}
