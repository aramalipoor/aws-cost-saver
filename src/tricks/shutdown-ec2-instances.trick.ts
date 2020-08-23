import AWS from 'aws-sdk';
import Listr, { ListrTaskWrapper } from 'listr';
import chalk from 'chalk';

import { TrickInterface } from '../interfaces/trick.interface';
import { EC2InstanceState } from '../states/ec2-instance.state';

export type ShutdownEC2InstancesState = EC2InstanceState[];

export class ShutdownEC2InstancesTrick
  implements TrickInterface<ShutdownEC2InstancesState> {
  private ec2Client: AWS.EC2;

  constructor() {
    this.ec2Client = new AWS.EC2();
  }

  getMachineName(): string {
    return 'shutdown-ec2-instances';
  }

  getDisplayName(): string {
    return 'Shutdown EC2 Instances';
  }

  async conserve(
    subListr: Listr,
    dryRun: boolean,
  ): Promise<ShutdownEC2InstancesState> {
    const reservations = await this.listReservations();
    const currentState = await this.getCurrentState(reservations);

    for (const instance of currentState) {
      subListr.add({
        title: chalk.blueBright(`${instance.id} / ${instance.name}`),
        task: (ctx, task) => this.conserveInstance(task, dryRun, instance),
      });
    }

    return currentState;
  }

  async restore(
    subListr: Listr,
    dryRun: boolean,
    originalState: ShutdownEC2InstancesState,
  ): Promise<void> {
    for (const instance of originalState) {
      subListr.add({
        title: chalk.blueBright(instance.id),
        task: (ctx, task) => this.restoreInstance(task, dryRun, instance),
      });
    }
  }

  private async conserveInstance(
    task: ListrTaskWrapper,
    dryRun: boolean,
    instanceState: EC2InstanceState,
  ): Promise<void> {
    if (dryRun) {
      task.skip('Skipped due to dry-run');
    } else if (instanceState.state === 'running') {
      await this.ec2Client
        .stopInstances({
          InstanceIds: [instanceState.id],
        })
        .promise();
      task.output = 'Stopped';
    } else {
      task.skip(
        `Not in a "running" state instead in "${instanceState.state}" state`,
      );
    }
  }

  private async restoreInstance(
    task: ListrTaskWrapper,
    dryRun: boolean,
    instanceState: EC2InstanceState,
  ): Promise<void> {
    if (dryRun) {
      task.skip(`Skipped due to dry-run`);
    } else if (instanceState.state === 'running') {
      await this.ec2Client
        .startInstances({
          InstanceIds: [instanceState.id],
        })
        .promise();
      task.output = `Started`;
    } else {
      task.skip(
        `Was not in a "running" state instead in "${instanceState.state}" state`,
      );
    }
  }

  private getCurrentState(
    reservations: AWS.EC2.ReservationList,
  ): EC2InstanceState[] {
    return ([] as EC2InstanceState[]).concat(
      ...reservations.map(reservation => {
        return (
          reservation.Instances?.map(
            (instance): EC2InstanceState => {
              if (
                !instance.InstanceId ||
                !instance.State ||
                !instance.State.Name
              ) {
                throw new Error(
                  `Unexpected EC2 instance: ${JSON.stringify(instance)}`,
                );
              }

              const nameTag = instance.Tags?.filter(
                t => t.Key?.toString().toLowerCase() === 'name',
              )
                .map(t => t.Value)
                .join(' ');

              return {
                id: instance.InstanceId,
                name: nameTag || '<-no name->',
                state: instance.State.Name,
              };
            },
          ) || []
        );
      }),
    );
  }

  private async listReservations(): Promise<AWS.EC2.ReservationList> {
    return (
      (await this.ec2Client.describeInstances({}).promise()).Reservations || []
    );
  }
}
