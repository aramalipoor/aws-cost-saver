import AWS from 'aws-sdk';
import chalk from 'chalk';
import { Listr, ListrTask, ListrTaskWrapper } from 'listr2';
import { TagFilterList } from 'aws-sdk/clients/resourcegroupstaggingapi';

import { TrickInterface } from '../types/trick.interface';
import { TrickOptionsInterface } from '../types/trick-options.interface';

import { EC2InstanceState } from '../states/ec2-instance.state';
import { TrickContext } from '../types/trick-context';

export type ShutdownEC2InstancesState = EC2InstanceState[];

export class ShutdownEC2InstancesTrick
  implements TrickInterface<ShutdownEC2InstancesState> {
  static machineName = 'shutdown-ec2-instances';

  private ec2Client: AWS.EC2;

  constructor() {
    this.ec2Client = new AWS.EC2();
  }

  getMachineName(): string {
    return ShutdownEC2InstancesTrick.machineName;
  }

  async prepareTags(
    context: TrickContext,
    task: ListrTaskWrapper<any, any>,
    options: TrickOptionsInterface,
  ): Promise<void> {
    task.skip(`ignored, no need to prepare tags`);
  }

  async getCurrentState(
    context: TrickContext,
    task: ListrTaskWrapper<any, any>,
    currentState: ShutdownEC2InstancesState,
    options: TrickOptionsInterface,
  ): Promise<Listr> {
    const reservations = await this.listReservations(task, options);

    const subListr = task.newListr([], {
      concurrent: 10,
      exitOnError: false,
      rendererOptions: {
        collapse: true,
      },
    });

    if (!reservations || reservations.length === 0) {
      task.skip(chalk.dim('no EC2 instances found'));
      return subListr;
    }

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
                      t =>
                        (t.Key as string).toString().toLowerCase() === 'name',
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
              options: {
                persistentOutput: true,
              },
            };
          },
        ) || [],
      );
    }

    return subListr;
  }

  async conserve(
    task: ListrTaskWrapper<any, any>,
    currentState: ShutdownEC2InstancesState,
    options: TrickOptionsInterface,
  ): Promise<Listr> {
    const subListr = task.newListr([], {
      concurrent: 10,
      exitOnError: false,
      rendererOptions: {
        collapse: true,
      },
    });

    if (currentState && currentState.length > 0) {
      for (const instance of currentState) {
        subListr.add({
          title: chalk.blue(`${instance.id} / ${instance.name}`),
          task: (ctx, task) => this.conserveInstance(task, instance, options),
          options: {
            persistentOutput: true,
          },
        });
      }
    } else {
      task.skip(chalk.dim(`no EC2 instances found`));
    }

    return subListr;
  }

  async restore(
    task: ListrTaskWrapper<any, any>,
    originalState: ShutdownEC2InstancesState,
    options: TrickOptionsInterface,
  ): Promise<Listr> {
    const subListr = task.newListr([], {
      concurrent: 10,
      exitOnError: false,
      rendererOptions: {
        collapse: true,
      },
    });

    if (originalState && originalState.length > 0) {
      for (const instance of originalState) {
        subListr.add({
          title: chalk.blue(`${instance.id} / ${instance.name}`),
          task: (ctx, task) => this.restoreInstance(task, instance, options),
          options: {
            persistentOutput: true,
          },
        });
      }
    } else {
      task.skip(chalk.dim(`no EC2 instances were conserved`));
    }

    return subListr;
  }

  private async listReservations(
    task: ListrTaskWrapper<any, any>,
    options: TrickOptionsInterface,
  ): Promise<AWS.EC2.ReservationList> {
    const reservations: AWS.EC2.ReservationList = [];

    // TODO Add logic to go through all pages
    task.output = 'fetching page 1...';
    reservations.push(
      ...((
        await this.ec2Client
          .describeInstances({
            Filters:
              options.tags &&
              ShutdownEC2InstancesTrick.prepareFilters(options.tags),
            MaxResults: 1000,
          })
          .promise()
      ).Reservations || []),
    );

    task.output = 'done';
    return reservations;
  }

  private async conserveInstance(
    task: ListrTaskWrapper<any, any>,
    instanceState: EC2InstanceState,
    options: TrickOptionsInterface,
  ): Promise<void> {
    if (instanceState.state !== 'running') {
      task.skip(
        chalk.dim(
          `Not in a "running" state instead in "${instanceState.state}" state`,
        ),
      );
      return;
    }

    if (options.dryRun) {
      task.skip(chalk.dim('skipped, would stop the instance'));
      return;
    }

    // TODO Stop multiple instances at a time
    task.output = 'stopping EC2 instance...';
    await this.ec2Client
      .stopInstances({
        InstanceIds: [instanceState.id],
      })
      .promise();

    task.output = 'waiting for EC2 instance to stop...';
    await this.ec2Client
      .waitFor('instanceStopped', {
        InstanceIds: [instanceState.id],
        $waiter: {
          delay: 10,
          maxAttempts: 60,
        },
      })
      .promise();

    task.output = 'stopped';
  }

  private async restoreInstance(
    task: ListrTaskWrapper<any, any>,
    instanceState: EC2InstanceState,
    options: TrickOptionsInterface,
  ): Promise<void> {
    if (instanceState.state !== 'running') {
      task.skip(
        chalk.dim(
          `Was not in a "running" state instead in "${instanceState.state}" state`,
        ),
      );
      return;
    }

    if (options.dryRun) {
      task.skip(chalk.dim(`skipped, would start the instance`));
      return;
    }

    task.output = 'starting EC2 instance...';
    await this.ec2Client
      .startInstances({
        InstanceIds: [instanceState.id],
      })
      .promise();

    task.output = 'waiting for EC2 instance to start...';
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

  private static prepareFilters(tags: TagFilterList): AWS.EC2.FilterList {
    return tags.map(t => ({ Name: `tag:${t.Key}`, Values: t.Values }));
  }
}
