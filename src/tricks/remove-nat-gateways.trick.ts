import AWS from 'aws-sdk';
import chalk from 'chalk';
import Listr, { ListrOptions, ListrTask, ListrTaskWrapper } from 'listr';

import { TrickInterface } from '../interfaces/trick.interface';
import { TrickOptionsInterface } from '../interfaces/trick-options.interface';

import {
  NatGatewayRouteState,
  NatGatewayState,
} from '../states/nat-gateway.state';

export type RemoveNatGatewaysState = NatGatewayState[];

export class RemoveNatGatewaysTrick
  implements TrickInterface<RemoveNatGatewaysState> {
  private ec2Client: AWS.EC2;

  static machineName = 'remove-nat-gateways';

  private routeTablesCache?: AWS.EC2.RouteTableList;

  constructor() {
    this.ec2Client = new AWS.EC2();
  }

  getMachineName(): string {
    return RemoveNatGatewaysTrick.machineName;
  }

  getConserveTitle(): string {
    return 'Remove NAT Gateways';
  }

  getRestoreTitle(): string {
    return 'Recreate NAT Gateways';
  }

  async getCurrentState(
    task: ListrTaskWrapper,
    currentState: RemoveNatGatewaysState,
    options: TrickOptionsInterface,
  ): Promise<Listr> {
    const natGateways = await this.listNatGateways(task);

    const subListr = new Listr({
      concurrent: false,
      exitOnError: false,
      collapse: false,
    } as ListrOptions);

    subListr.add(
      natGateways.map(
        (natGateway): ListrTask => {
          return {
            title: natGateway.NatGatewayId || chalk.italic('<no-id>'),
            task: async (ctx, task) => {
              if (
                !natGateway.NatGatewayId ||
                !natGateway.VpcId ||
                !natGateway.SubnetId ||
                !natGateway.State
              ) {
                throw new Error(
                  `Unexpected values on Nat Gateway: ${JSON.stringify(
                    natGateway,
                  )}`,
                );
              }

              task.output = 'Finding routes...';
              const routes = await this.findRoutes(natGateway);

              currentState.push({
                id: natGateway.NatGatewayId,
                vpcId: natGateway.VpcId,
                subnetId: natGateway.SubnetId,
                state: natGateway.State,
                routes,
                allocationIds:
                  natGateway.NatGatewayAddresses?.map(
                    a => a.AllocationId || '',
                  ) || [],
                tags: natGateway.Tags || [],
              });
            },
          };
        },
      ),
    );

    return subListr;
  }

  async conserve(
    task: ListrTaskWrapper,
    currentState: RemoveNatGatewaysState,
    options: TrickOptionsInterface,
  ): Promise<Listr> {
    const subListr = new Listr({
      concurrent: 1,
      exitOnError: false,
      collapse: false,
    } as ListrOptions);

    for (const natGateway of currentState) {
      subListr.add({
        title: chalk.blueBright(
          `${natGateway.id} / ${RemoveNatGatewaysTrick.getNameTag(natGateway)}`,
        ),
        task: (ctx, task) => this.conserveNatGateway(task, natGateway, options),
      });
    }

    return subListr;
  }

  async restore(
    task: ListrTaskWrapper,
    originalState: RemoveNatGatewaysState,
    options: TrickOptionsInterface,
  ): Promise<Listr> {
    const subListr = new Listr({
      concurrent: 1,
      exitOnError: false,
      collapse: false,
    } as ListrOptions);

    for (const natGateway of originalState) {
      subListr.add({
        title: chalk.blueBright(natGateway.id),
        task: (ctx, task) => this.restoreNatGateway(task, natGateway, options),
      });
    }

    return subListr;
  }

  private async conserveNatGateway(
    task: ListrTaskWrapper,
    natGateway: NatGatewayState,
    options: TrickOptionsInterface,
  ): Promise<void> {
    if (natGateway.state !== 'available') {
      task.skip(
        `Skipped, state is not "available", it is "${natGateway.state}" instead`,
      );
      return;
    }

    if (options.dryRun) {
      task.skip(`Skipped, would remove NAT Gateway`);
      return;
    }

    task.output = 'Deleting NAT gateway...';
    await this.ec2Client
      .deleteNatGateway({
        NatGatewayId: natGateway.id,
      })
      .promise();

    task.output = 'NAT Gateway Deleted';
  }

  private async restoreNatGateway(
    task: ListrTaskWrapper,
    natGateway: NatGatewayState,
    options: TrickOptionsInterface,
  ): Promise<void> {
    const allocationId =
      natGateway.allocationIds && natGateway.allocationIds[0];

    if (natGateway.state !== 'available') {
      task.skip(
        `Skipped, state was not "available", it was "${natGateway.state}" instead`,
      );
      return;
    }

    if (options.dryRun) {
      task.skip(
        `Skipped, would create NAT Gateway on subnet = ${natGateway.subnetId} and allocate EIP = ${allocationId}`,
      );
      return;
    }

    task.output = 'Creating NAT gateway...';
    const result = await this.ec2Client
      .createNatGateway({
        AllocationId: allocationId,
        SubnetId: natGateway.subnetId,
        TagSpecifications: [
          {
            ResourceType: 'natgateway',
            Tags: natGateway.tags,
          },
        ],
      })
      .promise();
    const newNatGatewayId = result.NatGateway?.NatGatewayId as string;

    task.output = 'Waiting for NAT Gateway to be available...';
    await this.ec2Client
      .waitFor('natGatewayAvailable', {
        NatGatewayIds: [newNatGatewayId],
      })
      .promise();

    for (const route of natGateway.routes) {
      task.output = `Adding NAT gateway to original route tables (${route.destinationCidr ||
        route.destinationIpv6Cidr ||
        route.destinationPrefixListId})...`;
      await this.ec2Client
        .replaceRoute({
          RouteTableId: route.routeTableId,
          NatGatewayId: newNatGatewayId,
          ...(route.destinationCidr
            ? { DestinationCidrBlock: route.destinationCidr }
            : route.destinationIpv6Cidr
            ? { DestinationIpv6CidrBlock: route.destinationIpv6Cidr }
            : { DestinationPrefixListId: route.destinationPrefixListId }),
        })
        .promise();
    }

    task.output = 'NAT Gateway Created';
  }

  private async listNatGateways(
    task: ListrTaskWrapper,
  ): Promise<AWS.EC2.NatGatewayList> {
    const natGateways: AWS.EC2.NatGatewayList = [];

    // TODO Add logic to go through all pages
    task.output = 'Fetching page 1...';
    natGateways.push(
      ...((
        await this.ec2Client.describeNatGateways({ MaxResults: 10 }).promise()
      ).NatGateways || []),
    );

    return natGateways;
  }

  private static getNameTag(natGateway: NatGatewayState) {
    return natGateway.tags
      .filter(t => (t.Key as string).toString().toLowerCase() === 'name')
      .map(t => t.Value)
      .join(' ');
  }

  private async findRoutes(natGateway: AWS.EC2.NatGateway) {
    const routes: NatGatewayRouteState[] = [];
    const routeTables = await this.getAllRouteTables();

    routeTables?.forEach(rt => {
      if (rt.Routes && rt.Routes.length > 0) {
        for (const route of rt.Routes) {
          if (route.NatGatewayId === natGateway.NatGatewayId) {
            routes.push({
              routeTableId: rt.RouteTableId as string,
              destinationCidr: route.DestinationCidrBlock,
              destinationIpv6Cidr: route.DestinationCidrBlock,
              destinationPrefixListId: route.DestinationPrefixListId,
            });
          }
        }
      }
    });

    return routes;
  }

  private async getAllRouteTables() {
    if (!this.routeTablesCache) {
      // TODO Handle pagination
      const result = await this.ec2Client.describeRouteTables({}).promise();

      this.routeTablesCache = result.RouteTables;
    }

    return this.routeTablesCache;
  }
}
