import AWS from 'aws-sdk';
import Listr, { ListrTask, ListrTaskWrapper } from 'listr';
import chalk from 'chalk';

import { TrickInterface } from '../interfaces/trick.interface';
import { TrickOptionsInterface } from '../interfaces/trick-options.interface';

import { EC2InstanceState } from '../states/ec2-instance.state';

export type ShutdownEC2InstancesState = EC2InstanceState[];

export class ShutdownEC2InstancesTrick
  implements TrickInterface<ShutdownEC2InstancesState> {
  private ec2Client: AWS.EC2;

  static machineName = 'shutdown-ec2-instances';

  constructor() {
    this.ec2Client = new AWS.EC2();
  }

  getMachineName(): string {
    return ShutdownEC2InstancesTrick.machineName;
  }

  getConserveTitle(): string {
    return 'Shutdown EC2 Instances';
  }

  getRestoreTitle(): string {
    return 'Start EC2 Instances';
  }

  async getCurrentState(
    task: ListrTaskWrapper,
    currentState: ShutdownEC2InstancesState,
    options: TrickOptionsInterface,
  ): Promise<Listr> {
    const reservations = await this.listReservations(task);

    if (!reservations || reservations.length === 0) {
      task.skip('No EC2 instances found');
      return;
    }

    const subListr = new Listr({
      concurrent: 10,
      exitOnError: false,
      // @ts-ignore
      collapse: false,
    });

    for (const reservation of reservations) {
      subListr.add(
        reservation.Instances?.map(
          (instance): ListrTask => {
            return {
              title: instance.InstanceId || chalk.italic('<no-instance-id>'),
              task: async () => {
                if (
                  !instance.InstanceId ||
                  !instance.State ||
                  !instance.State.Name
                ) {
                  throw new Error(
                    `Unexpected EC2 instance: ${JSON.stringify(instance)}`,
                  );
                }

                const nameTag = instance.Tags
                  ? instance.Tags.filter(
                      t => t.Key?.toString().toLowerCase() === 'name',
                    )
                      .map(t => t.Value)
                      .join(' ')
                  : '<no-name>';

                const instanceState: EC2InstanceState = {
                  id: instance.InstanceId,
                  state: instance.State.Name,
                  name: nameTag,
                };

                currentState.push(instanceState);
              },
            };
          },
        ) || [],
      );
    }

    return subListr;
  }

  async conserve(
    task: ListrTaskWrapper,
    currentState: ShutdownEC2InstancesState,
    options: TrickOptionsInterface,
  ): Promise<Listr> {
    const subListr = new Listr({
      concurrent: 10,
      exitOnError: false,
      // @ts-ignore
      collapse: false,
    });

    if (currentState && currentState.length > 0) {
      for (const instance of currentState) {
        subListr.add({
          title: chalk.blueBright(`${instance.id} / ${instance.name}`),
          task: (ctx, task) => this.conserveInstance(task, instance, options),
        });
      }
    } else {
      task.skip(`No EC2 instances found`);
    }

    return subListr;
  }

  async restore(
    task: ListrTaskWrapper,
    originalState: ShutdownEC2InstancesState,
    options: TrickOptionsInterface,
  ): Promise<Listr> {
    const subListr = new Listr({
      concurrent: 10,
      exitOnError: false,
      // @ts-ignore
      collapse: false,
    });

    if (originalState && originalState.length > 0) {
      for (const instance of originalState) {
        subListr.add({
          title: chalk.blueBright(`${instance.id} / ${instance.name}`),
          task: (ctx, task) => this.restoreInstance(task, instance, options),
        });
      }
    } else {
      task.skip(`No EC2 instances were conserved`);
    }

    return subListr;
  }

  private async listReservations(
    task: ListrTaskWrapper,
  ): Promise<AWS.EC2.ReservationList> {
    const reservations: AWS.EC2.ReservationList = [];

    // TODO Add logic to go through all pages
    task.output = 'Fetching page 1...';
    reservations.push(
      ...((
        await this.ec2Client.describeInstances({ MaxResults: 1000 }).promise()
      ).Reservations || []),
    );

    return reservations;
  }

  private async conserveInstance(
    task: ListrTaskWrapper,
    instanceState: EC2InstanceState,
    options: TrickOptionsInterface,
  ): Promise<void> {
    if (instanceState.state !== 'running') {
      task.skip(
        `Not in a "running" state instead in "${instanceState.state}" state`,
      );
      return;
    }

    if (options.dryRun) {
      task.skip('Skipped, would stop the instance');
      return;
    }

    // TODO Stop multiple instances at a time
    task.output = 'Stopping EC2 instance...';
    await this.ec2Client
      .stopInstances({
        InstanceIds: [instanceState.id],
      })
      .promise();

    task.output = 'Waiting for EC2 instance to stop...';
    await this.ec2Client
      .waitFor('instanceStopped', {
        InstanceIds: [instanceState.id],
        $waiter: {
          delay: 10,
          maxAttempts: 60,
        },
      })
      .promise();

    task.output = 'Stopped';
  }

  private async restoreInstance(
    task: ListrTaskWrapper,
    instanceState: EC2InstanceState,
    options: TrickOptionsInterface,
  ): Promise<void> {
    if (instanceState.state !== 'running') {
      task.skip(
        `Was not in a "running" state instead in "${instanceState.state}" state`,
      );
      return;
    }

    if (options.dryRun) {
      task.skip(`Skipped, would start the instance`);
      return;
    }

    task.output = 'Starting EC2 instance...';
    await this.ec2Client
      .startInstances({
        InstanceIds: [instanceState.id],
      })
      .promise();

    task.output = 'Waiting for EC2 instance to start...';
    await this.ec2Client
      .waitFor('instanceRunning', {
        InstanceIds: [instanceState.id],
        $waiter: {
          delay: 15,
          maxAttempts: 100,
        },
      })
      .promise();

    task.output = `Started`;
  }
}
