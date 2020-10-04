import chalk from 'chalk';
import { flags } from '@oclif/command';
import {
  Listr,
  ListrDefaultRendererOptions,
  ListrTask,
  ListrTaskWrapper,
} from 'listr2';
import figures from 'figures';

import BaseCommand from '../base-command';
import { transformTagsFlagToFilterList, configureAWS } from '../util';
import { TrickRegistry } from '../tricks/trick.registry';
import { TrickInterface } from '../types/trick.interface';

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

import { RootState } from '../types/root-state';
import { RootContext } from '../types/root-context';
import { TrickOptionsInterface } from '../types/trick-options.interface';
import { TrickContext } from '../types/trick-context';

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
    `$ aws-cost-saver conserve ${chalk.yellow('--only-summary')}`,
    `$ aws-cost-saver conserve ${chalk.yellow('-d -n -m -t Team=Tacos')}`,
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
      description: 'Only list actions and do not actually execute them.',
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
    'overwrite-state-file': flags.boolean({
      char: 'w',
      default: false,
      description:
        'Overwrite state-file if it exists. WARNING: Use with caution as this might overwrite non-restored state-file.',
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
    'only-summary': flags.boolean({
      char: 'm',
      default: false,
      description:
        'Do not render live progress. Only print final summary in a clean format.',
    }),
    tag: flags.string({
      char: 't',
      multiple: true,
      required: false,
      description:
        'Resource tags to narrow down affected resources. Multiple provided tags will be AND-ed.',
    }),
  };

  static args = [];

  async run() {
    const { flags } = this.parse(Conserve);

    const awsConfig = await configureAWS(flags.profile, flags.region);

    await this.validateStateFilePath(flags);

    this.printBanner(awsConfig, flags);

    const tricks = this.getEnabledTricks(flags);
    const rootContext: RootContext = {};
    const rootState: RootState = {};
    const rootTaskList: ListrTask[] = [];
    const options: TrickOptionsInterface = {
      dryRun: flags['dry-run'],
      tags: flags.tag && transformTagsFlagToFilterList(flags.tag),
    };

    for (const trick of tricks) {
      rootTaskList.push({
        title: `${chalk.dim(`conserve:`)} ${trick.getMachineName()}`,
        task: (ctx, task) => {
          rootContext[trick.getMachineName()] = {};
          rootState[trick.getMachineName()] = [];

          return this.createTrickListr({
            trickTask: task,
            trickContext: rootContext[trick.getMachineName()],
            trickState: rootState[trick.getMachineName()],
            trickInstance: trick,
            trickOptions: options,
          });
        },
      });
    }

    const listr = new Listr(rootTaskList, {
      renderer: flags['only-summary'] ? 'silent' : 'default',
      concurrent: true,
      exitOnError: false,
      rendererOptions: {
        collapse: true,
        showTimer: true,
        showSubtasks: true,
        clearOutput: true,
      },
    } as ListrDefaultRendererOptions<any>);

    await listr.run(rootContext);
    this.renderSummary(listr.tasks);

    if (!flags['no-state-file']) {
      await this.writeStateFile(flags['state-file'], rootState);
      this.log(
        `  ${chalk.green(figures.pointer)} wrote state to ${chalk.green(
          flags['state-file'],
        )}`,
      );
    }

    const errors = this.collectErrors(listr.tasks);

    if (errors && errors.length > 0) {
      if (errors.length < listr.tasks.length) {
        this.log(
          `\n${chalk.yellow(figures.tick)} partially finished, with ${chalk.red(
            `${errors.length} failed tricks out of ${listr.tasks.length}`,
          )}.`,
        );
        throw new Error('ConservePartialFailure');
      } else {
        this.log(
          `\n${chalk.yellow(figures.cross)} All ${
            listr.tasks.length
          } tricks failed.`,
        );
        throw new Error(`ConserveFailure`);
      }
    } else if (flags['dry-run']) {
      this.log(
        `\n${chalk.yellow(
          ` ${figures.warning} skipped conserve due to dry-run.`,
        )}`,
      );
    } else {
      this.log(`\n ${chalk.green(figures.tick)} successfully conserved.`);
    }
  }

  private createTrickListr(cfg: {
    trickTask: ListrTaskWrapper<any, any>;
    trickContext: TrickContext;
    trickState: Record<string, any>[];
    trickInstance: TrickInterface<any>;
    trickOptions: TrickOptionsInterface;
  }): Listr<any, any, any> {
    return cfg.trickTask.newListr(
      [
        {
          title: 'prepare tags',
          task: (ctx, task) =>
            cfg.trickInstance.prepareTags(
              task,
              cfg.trickContext,
              cfg.trickOptions,
            ),
        },
        {
          title: 'fetch current state',
          task: (ctx, task) =>
            cfg.trickInstance.getCurrentState(
              task,
              cfg.trickContext,
              cfg.trickState,
              cfg.trickOptions,
            ),
        },
        {
          title: 'conserve resources',
          task: (ctx, task) =>
            cfg.trickInstance.conserve(task, cfg.trickState, cfg.trickOptions),
        },
      ],
      {
        concurrent: false,
        exitOnError: false,
        rendererOptions: {
          collapse: true,
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
        this.log(`could not find a trick named ${chalk.yellow(trickName)}`);
        this.log(
          `run ${chalk.yellow(
            'aws-cost-saver conserve --help',
          )} to get a list of available tricks.\n`,
        );
        throw new Error('TrickNotFound');
      }

      return trick;
    });
  }
}
