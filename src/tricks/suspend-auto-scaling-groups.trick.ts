import AWS from 'aws-sdk';
import Listr, { ListrOptions, ListrTaskWrapper } from 'listr';
import chalk from 'chalk';

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

  getConserveTitle(): string {
    return 'Suspend Auto Scaling Groups';
  }

  getRestoreTitle(): string {
    return 'Resume Auto Scaling Groups';
  }

  async getCurrentState(
    task: ListrTaskWrapper,
    currentState: SuspendAutoScalingGroupsState,
    options: TrickOptionsInterface,
  ): Promise<void> {
    const scalingGroups = await this.listAutoScalingGroups(task);

    if (!scalingGroups || scalingGroups.length === 0) {
      task.skip('No ASG found');
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
    task: ListrTaskWrapper,
    currentState: SuspendAutoScalingGroupsState,
    options: TrickOptionsInterface,
  ): Promise<Listr> {
    const subListr = new Listr({
      concurrent: 10,
      exitOnError: false,
      collapse: false,
    } as ListrOptions);

    if (currentState && currentState.length > 0) {
      for (const asgState of currentState) {
        subListr.add({
          title: chalk.blueBright(`${asgState.name}`),
          task: (ctx, task) => this.conserveProcesses(task, asgState, options),
        });
      }
    } else {
      task.skip(`No auto scaling groups found`);
    }

    return subListr;
  }

  async restore(
    task: ListrTaskWrapper,
    originalState: SuspendAutoScalingGroupsState,
    options: TrickOptionsInterface,
  ): Promise<Listr> {
    const subListr = new Listr({
      concurrent: 10,
      exitOnError: false,
      collapse: false,
    } as ListrOptions);

    if (originalState && originalState.length > 0) {
      for (const asgState of originalState) {
        subListr.add({
          title: chalk.blueBright(`${asgState.name}`),
          task: (ctx, task) => this.restoreProcesses(task, asgState, options),
        });
      }
    } else {
      task.skip(`No auto scaling groups were conserved`);
    }

    return subListr;
  }

  private async listAutoScalingGroups(
    task: ListrTaskWrapper,
  ): Promise<AWS.AutoScaling.AutoScalingGroups> {
    const groups: AWS.AutoScaling.AutoScalingGroups = [];

    // TODO Add logic to go through all pages
    task.output = 'Fetching page 1...';
    groups.push(
      ...(
        await this.asClient
          .describeAutoScalingGroups({ MaxRecords: 100 })
          .promise()
      ).AutoScalingGroups,
    );

    return groups;
  }

  private async conserveProcesses(
    task: ListrTaskWrapper,
    asgState: AutoScalingGroupState,
    options: TrickOptionsInterface,
  ): Promise<void> {
    if (options.dryRun) {
      task.skip('Skipped, would suspend ASG processes');
      return;
    }

    task.output = 'Suspending ASG processes...';
    await this.asClient
      .suspendProcesses({
        AutoScalingGroupName: asgState.name,
      })
      .promise();

    task.output = 'Suspended';
  }

  private async restoreProcesses(
    task: ListrTaskWrapper,
    asgState: AutoScalingGroupState,
    options: TrickOptionsInterface,
  ): Promise<void> {
    if (options.dryRun) {
      task.skip(`Skipped, would resume ASG processes`);
      return;
    }

    task.output = 'Resuming ASG...';
    await this.asClient
      .resumeProcesses({
        AutoScalingGroupName: asgState.name,
      })
      .promise();

    task.output = `Restored`;
  }
}
