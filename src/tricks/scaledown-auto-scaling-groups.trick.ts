import AWS from 'aws-sdk';
import chalk from 'chalk';
import { Listr, ListrTaskWrapper } from 'listr2';

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

  async getCurrentState(
    task: ListrTaskWrapper<any, any>,
    currentState: ScaledownAutoScalingGroupsState,
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
            desired: asg.DesiredCapacity,
            min: asg.MinSize,
            max: asg.MaxSize,
          };
        },
      ),
    );
  }

  async conserve(
    task: ListrTaskWrapper<any, any>,
    currentState: ScaledownAutoScalingGroupsState,
    options: TrickOptionsInterface,
  ): Promise<Listr> {
    const subListr = task.newListr([], {
      concurrent: 10,
      exitOnError: false,
      rendererOptions: {
        collapse: false,
        collapseSkips: false,
      },
    });

    if (currentState && currentState.length > 0) {
      for (const asgState of currentState) {
        subListr.add({
          title: chalk.greenBright(`${asgState.name}`),
          task: (ctx, task) =>
            this.conserveAutoScalingGroup(task, asgState, options),
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
    originalState: ScaledownAutoScalingGroupsState,
    options: TrickOptionsInterface,
  ): Promise<Listr> {
    const subListr = task.newListr([], {
      concurrent: 10,
      exitOnError: false,
      rendererOptions: {
        collapse: false,
      },
    });

    if (originalState && originalState.length > 0) {
      for (const asgState of originalState) {
        subListr.add({
          title: chalk.greenBright(`${asgState.name}`),
          task: (ctx, task) =>
            this.restoreAutoScalingGroup(task, asgState, options),
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

  private async conserveAutoScalingGroup(
    task: ListrTaskWrapper<any, any>,
    asgState: AutoScalingGroupState,
    options: TrickOptionsInterface,
  ): Promise<void> {
    if (options.dryRun) {
      task.skip(
        chalk.dim(
          'skipped, would scale down the ASG desired = 0 min = 0 max = 0',
        ),
      );
      return;
    }

    task.output = 'scaling down ASG...';
    await this.asClient
      .updateAutoScalingGroup({
        AutoScalingGroupName: asgState.name,
        DesiredCapacity: 0,
        MinSize: 0,
        MaxSize: 0,
      })
      .promise();

    task.output = 'scaled down';
  }

  private async restoreAutoScalingGroup(
    task: ListrTaskWrapper<any, any>,
    asgState: AutoScalingGroupState,
    options: TrickOptionsInterface,
  ): Promise<void> {
    if (options.dryRun) {
      task.skip(
        chalk.dim(
          `skipped, would restore the ASG to desired = ${asgState.desired} min = ${asgState.min} max = ${asgState.max}`,
        ),
      );
      return;
    }

    task.output = 'restoring ASG...';
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
