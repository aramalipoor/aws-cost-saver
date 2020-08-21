import { TrickInterface } from '../interfaces/trick.interface';

import { StopFargateEcsServicesTrick } from './stop-fargate-ecs-services.trick';
import { StopRdsDatabaseInstancesTrick } from './stop-rds-database-instances.trick';
// import { RemoveNatGatewaysTrick } from './remove-nat-gateways.trick';
import { ShutdownEC2InstancesTrick } from './shutdown-ec2-instances.trick';

export class TrickRegistry {
  private registry: TrickInterface<any>[] = [];

  public static initialize(): TrickRegistry {
    const registry = new TrickRegistry();

    registry.register(
      new StopFargateEcsServicesTrick(),
      new StopRdsDatabaseInstancesTrick(),
      new ShutdownEC2InstancesTrick(),

      // FIXME Removing NAT Gateway will confuse IaC like terraform to create a redundant gateway
      // new RemoveNatGatewaysTrick(),
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
