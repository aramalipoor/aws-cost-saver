import AWS from 'aws-sdk';
import chalk from 'chalk';
import Listr, { ListrTaskWrapper } from 'listr';

import { TrickInterface } from '../interfaces/trick.interface';
import { NatGatewayState } from '../states/nat-gateway.state';

export type RemoveNatGatewaysState = NatGatewayState[];

export class RemoveNatGatewaysTrick
  implements TrickInterface<RemoveNatGatewaysState> {
  private ec2Client: AWS.EC2;

  constructor() {
    this.ec2Client = new AWS.EC2();
  }

  getMachineName(): string {
    return 'remove-nat-gateways';
  }

  getDisplayName(): string {
    return 'Remove NAT Gateways';
  }

  async conserve(
    subListr: Listr,
    dryRun: boolean,
  ): Promise<RemoveNatGatewaysState> {
    const natGateways = await this.listNatGateways();
    const currentState = await this.getCurrentState(natGateways);

    for (const natGateway of currentState) {
      subListr.add({
        title: `${chalk.blueBright(natGateway.id)} / ${natGateway.tags
          .filter(t => t.Key?.toString().toLowerCase() === 'name')
          .join(' ')}`,
        task: (ctx, task) => this.conserveNatGateway(task, dryRun, natGateway),
      });
    }

    return currentState;
  }

  async restore(
    subListr: Listr,
    dryRun: boolean,
    originalState: RemoveNatGatewaysState,
  ): Promise<void> {
    for (const natGateway of originalState) {
      subListr.add({
        title: chalk.blueBright(natGateway.id),
        task: (ctx, task) => this.restoreNatGateway(task, dryRun, natGateway),
      });
    }
  }

  private async conserveNatGateway(
    task: ListrTaskWrapper,
    dryRun: boolean,
    natGateway: NatGatewayState,
  ): Promise<void> {
    if (dryRun) {
      task.skip(`Skipped due to dry-run`);
    } else {
      await this.ec2Client
        .deleteNatGateway({
          NatGatewayId: natGateway.id,
        })
        .promise();
      task.output = 'Deleted';
    }
  }

  private async restoreNatGateway(
    task: ListrTaskWrapper,
    dryRun: boolean,
    natGateway: NatGatewayState,
  ): Promise<void> {
    if (dryRun) {
      task.skip(`Skipped due to dry-run`);
    } else {
      await this.ec2Client
        .createNatGateway({
          AllocationId: natGateway.allocationIds && natGateway.allocationIds[0],
          SubnetId: natGateway.subnetId,
          TagSpecifications: [
            {
              ResourceType: 'natgateway',
              Tags: natGateway.tags,
            },
          ],
        })
        .promise();
      task.output = 'Created';
    }
  }

  private async getCurrentState(natGatewayList: AWS.EC2.NatGatewayList) {
    return Promise.all(
      natGatewayList.map(
        async (natGateway): Promise<NatGatewayState> => {
          if (
            !natGateway.NatGatewayId ||
            !natGateway.VpcId ||
            !natGateway.SubnetId ||
            !natGateway.Tags
          ) {
            throw new Error(
              `Unexpected values on Nat Gateway: ${JSON.stringify(natGateway)}`,
            );
          }

          return {
            id: natGateway.NatGatewayId,
            vpcId: natGateway.VpcId,
            subnetId: natGateway.SubnetId,
            allocationIds:
              natGateway.NatGatewayAddresses?.map(a => a.AllocationId || '') ||
              [],
            tags: natGateway.Tags,
          };
        },
      ),
    );
  }

  private async listNatGateways(): Promise<AWS.EC2.NatGatewayList> {
    return (
      (await this.ec2Client.describeNatGateways().promise()).NatGateways || []
    );
  }
}
