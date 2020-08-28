import AWS from 'aws-sdk';
import chalk from 'chalk';
import Listr, { ListrTask, ListrTaskWrapper } from 'listr';

import { TrickInterface } from '../interfaces/trick.interface';
import { TrickOptionsInterface } from '../interfaces/trick-options.interface';

import { NatGatewayState } from '../states/nat-gateway.state';

export type RemoveNatGatewaysState = NatGatewayState[];

export class RemoveNatGatewaysTrick
  implements TrickInterface<RemoveNatGatewaysState> {
  private ec2Client: AWS.EC2;

  static machineName = 'remove-nat-gateways';

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
      concurrent: true,
      exitOnError: false,
      // @ts-ignore
      collapse: false,
    });

    subListr.add(
      natGateways.map(
        (natGateway): ListrTask => {
          return {
            title: natGateway.NatGatewayId || chalk.italic('<no-id>'),
            task: async () => {
              if (
                !natGateway.NatGatewayId ||
                !natGateway.VpcId ||
                !natGateway.SubnetId
              ) {
                throw new Error(
                  `Unexpected values on Nat Gateway: ${JSON.stringify(
                    natGateway,
                  )}`,
                );
              }

              currentState.push({
                id: natGateway.NatGatewayId,
                vpcId: natGateway.VpcId,
                subnetId: natGateway.SubnetId,
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
      // @ts-ignore
      collapse: false,
    });

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
      // @ts-ignore
      collapse: false,
    });

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

    task.output = 'Waiting for NAT Gateway to be available...';
    await this.ec2Client
      .waitFor('natGatewayAvailable', {
        NatGatewayIds: [result.NatGateway?.NatGatewayId || ''],
      })
      .promise();

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
      .filter(t => t.Key?.toString().toLowerCase() === 'name')
      .map(t => t.Value)
      .join(' ');
  }
}
