import AWS from 'aws-sdk';
import chalk from 'chalk';
import { Listr, ListrTask, ListrTaskWrapper } from 'listr2';

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

  async getCurrentState(
    task: ListrTaskWrapper<any, any>,
    currentState: RemoveNatGatewaysState,
    options: TrickOptionsInterface,
  ): Promise<Listr> {
    const natGateways = await this.listNatGateways(task);

    const subListr = task.newListr([], {
      concurrent: 10,
      exitOnError: false,
      rendererOptions: {
        collapse: true,
      },
    });

    if (natGateways.length === 0) {
      return subListr;
    }

    task.output = 'fetching all routes...';
    await this.getAllRouteTables();

    task.output = 'fetching NAT gateways...';
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
                !natGateway.State ||
                !natGateway.NatGatewayAddresses
              ) {
                throw new Error(
                  `Unexpected values on Nat Gateway: ${JSON.stringify(
                    natGateway,
                  )}`,
                );
              }

              task.output = 'finding routes...';
              const routes = await this.findRoutes(natGateway);

              currentState.push({
                id: natGateway.NatGatewayId,
                vpcId: natGateway.VpcId,
                subnetId: natGateway.SubnetId,
                state: natGateway.State,
                routes,
                allocationIds: natGateway.NatGatewayAddresses.map(
                  a => a.AllocationId as string,
                ),
                tags: natGateway.Tags as AWS.EC2.TagList,
              });
            },
            options: {
              persistentOutput: true,
            },
          };
        },
      ),
    );

    task.output = 'done';
    return subListr;
  }

  async conserve(
    task: ListrTaskWrapper<any, any>,
    currentState: RemoveNatGatewaysState,
    options: TrickOptionsInterface,
  ): Promise<Listr> {
    const subListr = task.newListr([], {
      concurrent: 1,
      exitOnError: false,
      rendererOptions: {
        collapse: true,
      },
    });

    for (const natGateway of currentState) {
      subListr.add({
        title: chalk.blue(
          `${natGateway.id} / ${RemoveNatGatewaysTrick.getNameTag(natGateway)}`,
        ),
        task: (ctx, task) => this.conserveNatGateway(task, natGateway, options),
        options: {
          persistentOutput: true,
        },
      });
    }

    return subListr;
  }

  async restore(
    task: ListrTaskWrapper<any, any>,
    originalState: RemoveNatGatewaysState,
    options: TrickOptionsInterface,
  ): Promise<Listr> {
    const subListr = task.newListr([], {
      concurrent: 1,
      exitOnError: false,
      rendererOptions: {
        collapse: true,
      },
    });

    for (const natGateway of originalState) {
      subListr.add({
        title: chalk.blue(natGateway.id),
        task: (ctx, task) => this.restoreNatGateway(task, natGateway, options),
        options: {
          persistentOutput: true,
        },
      });
    }

    return subListr;
  }

  private async conserveNatGateway(
    task: ListrTaskWrapper<any, any>,
    natGateway: NatGatewayState,
    options: TrickOptionsInterface,
  ): Promise<void> {
    if (natGateway.state !== 'available') {
      task.skip(
        chalk.dim(
          `skipped, state is not "available", it is "${natGateway.state}" instead`,
        ),
      );
      return;
    }

    if (options.dryRun) {
      task.skip(chalk.dim(`skipped, would remove NAT Gateway`));
      return;
    }

    task.output = 'deleting NAT gateway...';
    await this.ec2Client
      .deleteNatGateway({
        NatGatewayId: natGateway.id,
      })
      .promise();

    task.output = 'NAT Gateway deleted';
  }

  private async restoreNatGateway(
    task: ListrTaskWrapper<any, any>,
    natGateway: NatGatewayState,
    options: TrickOptionsInterface,
  ): Promise<void> {
    const allocationId =
      natGateway.allocationIds && natGateway.allocationIds[0];

    if (natGateway.state !== 'available') {
      task.skip(
        chalk.dim(
          `skipped, state was not "available", it was "${natGateway.state}" instead`,
        ),
      );
      return;
    }

    if (options.dryRun) {
      task.skip(
        chalk.dim(
          `skipped, would create NAT Gateway on subnet = ${natGateway.subnetId} and allocate EIP = ${allocationId}`,
        ),
      );
      return;
    }

    task.output = 'creating NAT gateway...';
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
    const newNatGatewayId = (result.NatGateway as AWS.EC2.NatGateway)
      .NatGatewayId as string;

    task.output = 'waiting for NAT Gateway to be available...';
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
          DestinationCidrBlock: route.destinationCidr,
          DestinationIpv6CidrBlock: route.destinationIpv6Cidr,
          DestinationPrefixListId: route.destinationPrefixListId,
        })
        .promise();
    }

    task.output = 'NAT Gateway Created';
  }

  private async listNatGateways(
    task: ListrTaskWrapper<any, any>,
  ): Promise<AWS.EC2.NatGatewayList> {
    const natGateways: AWS.EC2.NatGatewayList = [];

    // TODO Add logic to go through all pages
    task.output = 'fetching page 1...';
    natGateways.push(
      ...((
        await this.ec2Client.describeNatGateways({ MaxResults: 10 }).promise()
      ).NatGateways as AWS.EC2.NatGatewayList),
    );

    task.output = 'done';
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

    routeTables.forEach(rt => {
      if (rt.Routes && rt.Routes.length > 0) {
        for (const route of rt.Routes) {
          if (route.NatGatewayId === natGateway.NatGatewayId) {
            routes.push({
              routeTableId: rt.RouteTableId as string,
              destinationCidr: route.DestinationCidrBlock,
              destinationIpv6Cidr: route.DestinationIpv6CidrBlock,
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

      this.routeTablesCache = result.RouteTables as AWS.EC2.RouteTableList;
    }

    return this.routeTablesCache;
  }
}
