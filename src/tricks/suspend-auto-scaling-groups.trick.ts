import AWS from 'aws-sdk';
import chalk from 'chalk';
import { Listr, ListrTaskWrapper } from 'listr2';

import { TrickInterface } from '../interfaces/trick.interface';
import { TrickOptionsInterface } from '../interfaces/trick-options.interface';

import { AutoScalingGroupState } from '../states/auto-scaling-group.state';

export type SuspendAutoScalingGroupsState = AutoScalingGroupState[];

export class SuspendAutoScalingGroupsTrick
  implements TrickInterface<SuspendAutoScalingGroupsState> {
  private asClient: AWS.AutoScaling;

  static machineName = 'suspend-auto-scaling-groups';

  constructor() {
    this.asClient = new AWS.AutoScaling();
  }

  getMachineName(): string {
    return SuspendAutoScalingGroupsTrick.machineName;
  }

  async getCurrentState(
    task: ListrTaskWrapper<any, any>,
    currentState: SuspendAutoScalingGroupsState,
    options: TrickOptionsInterface,
  ): Promise<void> {
    const scalingGroups = await this.listAutoScalingGroups(task);

    if (!scalingGroups || scalingGroups.length === 0) {
      task.skip(chalk.dim('No ASG found'));
      return;
    }

    currentState.push(
      ...scalingGroups.map(
        (asg): AutoScalingGroupState => {
          return {
            name: asg.AutoScalingGroupName,
          };
        },
      ),
    );
  }

  async conserve(
    task: ListrTaskWrapper<any, any>,
    currentState: SuspendAutoScalingGroupsState,
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
      for (const asgState of currentState) {
        subListr.add({
          title: chalk.greenBright(`${asgState.name}`),
          task: (ctx, task) => this.conserveProcesses(task, asgState, options),
          options: {
            persistentOutput: true,
          },
        });
      }
    } else {
      task.skip(chalk.dim(`no auto scaling groups found`));
    }

    return subListr;
  }

  async restore(
    task: ListrTaskWrapper<any, any>,
    originalState: SuspendAutoScalingGroupsState,
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
      for (const asgState of originalState) {
        subListr.add({
          title: chalk.greenBright(`${asgState.name}`),
          task: (ctx, task) => this.restoreProcesses(task, asgState, options),
          options: {
            persistentOutput: true,
          },
        });
      }
    } else {
      task.skip(chalk.dim(`no auto scaling groups were conserved`));
    }

    return subListr;
  }

  private async listAutoScalingGroups(
    task: ListrTaskWrapper<any, any>,
  ): Promise<AWS.AutoScaling.AutoScalingGroups> {
    const groups: AWS.AutoScaling.AutoScalingGroups = [];

    // TODO Add logic to go through all pages
    task.output = 'fetching page 1...';
    groups.push(
      ...(
        await this.asClient
          .describeAutoScalingGroups({ MaxRecords: 100 })
          .promise()
      ).AutoScalingGroups,
    );

    task.output = 'done';
    return groups;
  }

  private async conserveProcesses(
    task: ListrTaskWrapper<any, any>,
    asgState: AutoScalingGroupState,
    options: TrickOptionsInterface,
  ): Promise<void> {
    if (options.dryRun) {
      task.skip(chalk.dim('skipped, would suspend ASG processes'));
      return;
    }

    task.output = 'suspending ASG processes...';
    await this.asClient
      .suspendProcesses({
        AutoScalingGroupName: asgState.name,
      })
      .promise();

    task.output = 'suspended';
  }

  private async restoreProcesses(
    task: ListrTaskWrapper<any, any>,
    asgState: AutoScalingGroupState,
    options: TrickOptionsInterface,
  ): Promise<void> {
    if (options.dryRun) {
      task.skip(chalk.dim(`skipped, would resume ASG processes`));
      return;
    }

    task.output = 'resuming ASG...';
    await this.asClient
      .resumeProcesses({
        AutoScalingGroupName: asgState.name,
      })
      .promise();

    task.output = `Restored`;
  }
}
