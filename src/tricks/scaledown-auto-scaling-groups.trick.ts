import AWS from 'aws-sdk';
import chalk from 'chalk';
import { Listr, ListrTaskWrapper } from 'listr2';

import { TrickInterface } from '../types/trick.interface';
import { TrickOptionsInterface } from '../types/trick-options.interface';

import { AutoScalingGroupState } from '../states/auto-scaling-group.state';
import { TrickContext } from '../types/trick-context';
import { AutoScalingGroup } from 'aws-sdk/clients/autoscaling';

export type ScaledownAutoScalingGroupsState = AutoScalingGroupState[];

export class ScaledownAutoScalingGroupsTrick
  implements TrickInterface<ScaledownAutoScalingGroupsState> {
  static machineName = 'scaledown-auto-scaling-groups';

  private asClient: AWS.AutoScaling;

  private rgtClient: AWS.ResourceGroupsTaggingAPI;

  constructor() {
    this.asClient = new AWS.AutoScaling();
    this.rgtClient = new AWS.ResourceGroupsTaggingAPI();
  }

  getMachineName(): string {
    return ScaledownAutoScalingGroupsTrick.machineName;
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
    currentState: ScaledownAutoScalingGroupsState,
    options: TrickOptionsInterface,
  ): Promise<void> {
    const scalingGroups = await this.listAutoScalingGroups(task);
    const filteredScalingGroups = scalingGroups.filter(sg =>
      this.isAsgIncluded(options, sg),
    );

    if (!filteredScalingGroups || filteredScalingGroups.length === 0) {
      task.skip(chalk.dim('no ASG found'));
      return;
    }

    currentState.push(
      ...filteredScalingGroups.map(
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
        collapse: true,
      },
    });

    if (currentState && currentState.length > 0) {
      for (const asgState of currentState) {
        subListr.add({
          title: chalk.blue(`${asgState.name}`),
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
        collapse: true,
      },
    });

    if (originalState && originalState.length > 0) {
      for (const asgState of originalState) {
        subListr.add({
          title: chalk.blue(`${asgState.name}`),
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

  private isAsgIncluded(
    options: TrickOptionsInterface,
    asg: AutoScalingGroup,
  ): boolean {
    if (!options.tags || options.tags.length === 0) {
      return true;
    }

    return options.tags.every(filterTag => {
      const fr = asg.Tags?.filter(
        asgTag =>
          asgTag.Key === filterTag.Key &&
          (!filterTag.Values ||
            filterTag.Values.length === 0 ||
            filterTag.Values.includes(asgTag.Value as string)),
      );

      return Boolean(fr?.length);
    });
  }
}
