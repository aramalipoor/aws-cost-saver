import chalk from 'chalk';
import { writeFileSync } from 'fs';
import { flags } from '@oclif/command';
import {
  Listr,
  ListrDefaultRendererOptions,
  ListrTask,
  ListrTaskWrapper,
} from 'listr2';

import BaseCommand from '../base-command';
import { configureAWS } from '../configure-aws';
import { TrickRegistry } from '../tricks/trick-registry';
import { TrickInterface } from '../interfaces/trick.interface';

import { ShutdownEC2InstancesTrick } from '../tricks/shutdown-ec2-instances.trick';
import { StopFargateEcsServicesTrick } from '../tricks/stop-fargate-ecs-services.trick';
import { StopRdsDatabaseInstancesTrick } from '../tricks/stop-rds-database-instances.trick';
import { DecreaseDynamoDBProvisionedRcuWcuTrick } from '../tricks/decrease-dynamodb-provisioned-rcu-wcu.trick';
import { RemoveNatGatewaysTrick } from '../tricks/remove-nat-gateways.trick';
import { SnapshotRemoveElasticacheRedisTrick } from '../tricks/snapshot-remove-elasticache-redis.trick';
import { DecreaseKinesisStreamsShardsTrick } from '../tricks/decrease-kinesis-streams-shards.trick';
import { StopRdsDatabaseClustersTrick } from '../tricks/stop-rds-database-clusters.trick';
import { ScaledownAutoScalingGroupsTrick } from '../tricks/scaledown-auto-scaling-groups.trick';
import { SuspendAutoScalingGroupsTrick } from '../tricks/suspend-auto-scaling-groups.trick';

import { RootState } from '../interfaces/root-state';
import { TrickOptionsInterface } from '../interfaces/trick-options.interface';

export default class Conserve extends BaseCommand {
  static tricksEnabledByDefault: readonly string[] = [
    ShutdownEC2InstancesTrick.machineName,
    StopFargateEcsServicesTrick.machineName,
    StopRdsDatabaseInstancesTrick.machineName,
    DecreaseDynamoDBProvisionedRcuWcuTrick.machineName,
    DecreaseKinesisStreamsShardsTrick.machineName,
    StopRdsDatabaseClustersTrick.machineName,
    SuspendAutoScalingGroupsTrick.machineName,
  ];

  static tricksDisabledByDefault: readonly string[] = [
    // Removing NAT gateways can confuse IaC like terraform
    RemoveNatGatewaysTrick.machineName,
    // This is an experimental trick, plus removing and recreating ElastiCache clusters takes a long time
    SnapshotRemoveElasticacheRedisTrick.machineName,
    // Scaling-down an ASG will cause all instances to be terminated and lose their temporary volumes
    ScaledownAutoScalingGroupsTrick.machineName,
  ];

  static description = [
    `This command uses various tricks to conserve as much money as possible.`,
    `To restore, this command will create a \`aws-cost-saver.json\` file to be use by "restore".`,
    `\nThese tricks are ${chalk.bold('enabled')} by default: ${chalk.green(
      `\n\t- ${Conserve.tricksEnabledByDefault.join('\n\t- ')}`,
    )}`,
    `\nThese tricks are ${chalk.bold('disabled')} by default: ${chalk.redBright(
      `\n\t- ${Conserve.tricksDisabledByDefault.join('\n\t- ')}`,
    )}`,
  ].join('\n');

  static examples = [
    `$ aws-cost-saver conserve`,
    `$ aws-cost-saver conserve ${chalk.yellow('--dry-run')}`,
    `$ aws-cost-saver conserve ${chalk.yellow('--no-state-file')}`,
    `$ aws-cost-saver conserve ${chalk.yellow(
      `--use-trick ${chalk.bold(
        SnapshotRemoveElasticacheRedisTrick.machineName,
      )}`,
    )}`,
    `$ aws-cost-saver conserve ${chalk.yellow(
      `--ignore-trick ${chalk.bold(StopRdsDatabaseInstancesTrick.machineName)}`,
    )}`,
    `$ aws-cost-saver conserve ${chalk.yellow(
      `--no-default-tricks --use-trick ${chalk.bold(
        StopFargateEcsServicesTrick.machineName,
      )}`,
    )}`,
    `$ aws-cost-saver conserve ${chalk.yellow(
      `--region ${chalk.bold(`eu-central-1`)} --profile ${chalk.bold(
        `my-aws-profile`,
      )}`,
    )}`,
    `$ aws-cost-saver conserve ${chalk.yellow(
      `--state-file ${chalk.bold(`new-path.json`)}`,
    )}`,
  ];

  static flags = {
    help: flags.help({ char: 'h' }),
    region: flags.string({ char: 'r', default: 'eu-central-1' }),
    profile: flags.string({ char: 'p', default: 'default' }),
    'dry-run': flags.boolean({
      char: 'd',
      description:
        'Only print actions and write state-file of current resources.',
    }),
    'state-file': flags.string({
      char: 's',
      default: 'aws-cost-saver.json',
      description:
        'Where to keep original state of stopped/decreased resources to restore later.',
    }),
    'no-state-file': flags.boolean({
      char: 'n',
      default: false,
      description:
        'Ignore saving current state, useful when want to only conserve as much money as possible.',
    }),
    'use-trick': flags.string({
      char: 'u',
      multiple: true,
      description:
        'Enables an individual trick. Useful for tricks that are disabled by default.',
    }),
    'ignore-trick': flags.string({
      char: 'i',
      multiple: true,
      description:
        'Disables an individual trick. Useful when you do not like to use a specific trick.',
    }),
    'no-default-tricks': flags.boolean({
      default: false,
      description:
        'Disables all default tricks. Useful alongside --use-trick when you only want a set of specific tricks to execute.',
    }),
  };

  static args = [];

  async run() {
    const { flags } = this.parse(Conserve);

    const awsConfig = await configureAWS(flags.profile, flags.region);

    await this.validateStateFilePath(flags);

    this.printBanner(awsConfig, flags);

    const tricks = this.getEnabledTricks(flags);
    const rootState: RootState = {};
    const rootTaskList: ListrTask[] = [];
    const options: TrickOptionsInterface = {
      dryRun: flags['dry-run'],
    };

    for (const trick of tricks) {
      rootTaskList.push({
        title: `${chalk.dim(`conserve:`)} ${trick.getMachineName()}`,
        task: (ctx, task) =>
          this.createTrickListr(task, rootState, trick, options),
      });
    }

    const listr = new Listr(rootTaskList, {
      concurrent: false,
      exitOnError: false,
      rendererOptions: {
        collapse: false,
        collapseSkips: false,
        showTimer: true,
        showSubtasks: true,
        clearOutput: false,
      },
    } as ListrDefaultRendererOptions<any>);

    await listr
      .run(rootState)
      .finally(() => {
        listr.rendererClassOptions = {
          collapse: true,
          collapseSkips: false,
          showTimer: true,
          showSubtasks: true,
          clearOutput: false,
        };
        if (!flags['no-state-file']) {
          writeFileSync(
            flags['state-file'],
            JSON.stringify(rootState, null, 2),
            'utf-8',
          );
          this.log(
            `\n  ${chalk.green('❯')} Wrote state file to ${chalk.green(
              flags['state-file'],
            )}`,
          );
        }
      })
      .then(() => {
        if (flags['dry-run']) {
          this.log(`\n${chalk.yellow(' ↓ Skipped conserve due to dry-run.')}`);
        } else {
          this.log(`\n ${chalk.green('✔')} Successfully conserved.`);
        }
      })
      .catch(error => {
        if (error.errors.length < rootTaskList.length) {
          this.log(
            `\n${chalk.yellow('✔')} Partially conserved, with ${chalk.red(
              `${error.errors.length} error(s)`,
            )}.`,
          );
        } else {
          this.log(
            `\n${chalk.red('✖')} All ${chalk.red(
              `${rootTaskList.length} tricks failed`,
            )} with errors.`,
          );
        }
      });
  }

  private createTrickListr(
    task: ListrTaskWrapper<any, any>,
    rootState: RootState,
    trick: TrickInterface<any>,
    options: TrickOptionsInterface,
  ): Listr<any, any, any> {
    rootState[trick.getMachineName()] = [];

    return task.newListr(
      [
        {
          title: 'fetch current state',
          task: (ctx, task) =>
            trick.getCurrentState(
              task,
              rootState[trick.getMachineName()],
              options,
            ),
        },
        {
          task: (ctx, task) =>
            trick.conserve(task, rootState[trick.getMachineName()], options),
        },
      ],
      {
        concurrent: false,
        rendererOptions: {
          collapse: false,
          collapseSkips: false,
        },
      },
    );
  }

  private getEnabledTricks(flags: Record<string, any>): TrickInterface<any>[] {
    const tricksRegistry = TrickRegistry.initialize();
    const tricks = tricksRegistry.all();

    let enabledTricks: string[] = flags['no-default-tricks']
      ? []
      : ([] as string[]).concat(...Conserve.tricksEnabledByDefault);

    if (flags['use-trick'] && flags['use-trick'].length > 0) {
      enabledTricks.push(...flags['use-trick']);
    }

    if (flags['ignore-trick'] && flags['ignore-trick'].length > 0) {
      enabledTricks = enabledTricks.filter(
        trickName => !flags['ignore-trick'].includes(trickName),
      );
    }

    return enabledTricks.map(trickName => {
      const trick = tricks.find(trick => trick.getMachineName() === trickName);

      if (!trick) {
        this.log(`Could not find a trick named ${chalk.yellow(trickName)}`);
        this.log(
          `Run ${chalk.yellow(
            'aws-cost-saver conserve --help',
          )} to get a list of available tricks.\n`,
        );
        throw new Error('TrickNotFound');
      }

      return trick;
    });
  }
}
