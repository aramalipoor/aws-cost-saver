import AWS from 'aws-sdk';
import Listr, { ListrOptions, ListrTaskWrapper } from 'listr';
import chalk from 'chalk';

import { TrickInterface } from '../interfaces/trick.interface';
import { TrickOptionsInterface } from '../interfaces/trick-options.interface';

import { AutoScalingGroupState } from '../states/auto-scaling-group.state';

export type ScaledownAutoScalingGroupsState = AutoScalingGroupState[];

export class ScaledownAutoScalingGroupsTrick
  implements TrickInterface<ScaledownAutoScalingGroupsState> {
  private asClient: AWS.AutoScaling;

  static machineName = 'scaledown-auto-scaling-groups';

  constructor() {
    this.asClient = new AWS.AutoScaling();
  }

  getMachineName(): string {
    return ScaledownAutoScalingGroupsTrick.machineName;
  }

  getConserveTitle(): string {
    return 'Scale-down Auto Scaling Groups';
  }

  getRestoreTitle(): string {
    return 'Restore Auto Scaling Groups';
  }

  async getCurrentState(
    task: ListrTaskWrapper,
    currentState: ScaledownAutoScalingGroupsState,
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
            desired: asg.DesiredCapacity,
            min: asg.MinSize,
            max: asg.MaxSize,
          };
        },
      ),
    );
  }

  async conserve(
    task: ListrTaskWrapper,
    currentState: ScaledownAutoScalingGroupsState,
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
          task: (ctx, task) =>
            this.conserveAutoScalingGroup(task, asgState, options),
        });
      }
    } else {
      task.skip(`No auto scaling groups found`);
    }

    return subListr;
  }

  async restore(
    task: ListrTaskWrapper,
    originalState: ScaledownAutoScalingGroupsState,
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
          task: (ctx, task) =>
            this.restoreAutoScalingGroup(task, asgState, options),
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

  private async conserveAutoScalingGroup(
    task: ListrTaskWrapper,
    asgState: AutoScalingGroupState,
    options: TrickOptionsInterface,
  ): Promise<void> {
    if (options.dryRun) {
      task.skip(
        'Skipped, would scale down the ASG desired = 0 min = 0 max = 0',
      );
      return;
    }

    task.output = 'Scaling down ASG...';
    await this.asClient
      .updateAutoScalingGroup({
        AutoScalingGroupName: asgState.name,
        DesiredCapacity: 0,
        MinSize: 0,
        MaxSize: 0,
      })
      .promise();

    task.output = 'Scaled down';
  }

  private async restoreAutoScalingGroup(
    task: ListrTaskWrapper,
    asgState: AutoScalingGroupState,
    options: TrickOptionsInterface,
  ): Promise<void> {
    if (options.dryRun) {
      task.skip(
        `Skipped, would restore the ASG to desired = ${asgState.desired} min = ${asgState.min} max = ${asgState.max}`,
      );
      return;
    }

    task.output = 'Restoring ASG...';
    await this.asClient
      .updateAutoScalingGroup({
        AutoScalingGroupName: asgState.name,
        DesiredCapacity: asgState.desired,
        MinSize: asgState.min,
        MaxSize: asgState.max,
      })
      .promise();

    task.output = `Restored`;
  }
}
