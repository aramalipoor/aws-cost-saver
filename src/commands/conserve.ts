import chalk from 'chalk';
import inquirer from 'inquirer';
import AWS from 'aws-sdk';
import Command, { flags } from '@oclif/command';
import { writeFileSync, existsSync } from 'fs';
import Listr, { ListrTask, ListrTaskWrapper } from 'listr';

import { configureAWS } from '../aws-configure';
import { TrickRegistry } from '../tricks/trick-registry';
import { TrickInterface } from '../interfaces/trick.interface';

import { ShutdownEC2InstancesTrick } from '../tricks/shutdown-ec2-instances.trick';
import { StopFargateEcsServicesTrick } from '../tricks/stop-fargate-ecs-services.trick';
import { StopRdsDatabaseInstancesTrick } from '../tricks/stop-rds-database-instances.trick';
import { DecreaseDynamoDBProvisionedRcuWcuTrick } from '../tricks/decrease-dynamodb-provisioved-rcu-wcu.trick';
import { RemoveNatGatewaysTrick } from '../tricks/remove-nat-gateways.trick';
import { SnapshotRemoveElasticacheRedisTrick } from '../tricks/snapshot-remove-elasticache-redis.trick';

export default class Conserve extends Command {
  static tricksEnabledByDefault: readonly string[] = [
    ShutdownEC2InstancesTrick.machineName,
    StopFargateEcsServicesTrick.machineName,
    StopRdsDatabaseInstancesTrick.machineName,
    DecreaseDynamoDBProvisionedRcuWcuTrick.machineName,
  ];

  static tricksDisabledByDefault: readonly string[] = [
    // Removing NAT gateways can confuse IaC like terraform
    RemoveNatGatewaysTrick.machineName,
    // This is an experimental trick, plus removing and recreating ElastiCache clusters takes a long time
    SnapshotRemoveElasticacheRedisTrick.machineName,
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
    const taskList: ListrTask[] = [];
    const stateRoot: any = {};

    for (const trick of tricks) {
      taskList.push({
        title: `${trick.getDisplayName()}`,
        task: async (ctx, task: ListrTaskWrapper<any>) => {
          const subListr = new Listr([], {
            concurrent: trick.canBeConcurrent(),
            exitOnError: false,
            // @ts-ignore
            collapse: false,
          });

          await trick.conserve(subListr, flags['dry-run']).then(result => {
            stateRoot[trick.getMachineName()] = result;

            if (!result || (Array.isArray(result) && result.length === 0)) {
              task.skip('No resources found');
            }
          });

          return subListr;
        },
        // @ts-ignore
        collapse: false,
      } as ListrTask);
    }

    await new Listr(taskList, {
      concurrent: true,
      exitOnError: false,
      // @ts-ignore
      collapse: false,
    })
      .run()
      .finally(() => {
        if (!flags['no-state-file']) {
          writeFileSync(
            flags['state-file'],
            JSON.stringify(stateRoot, null, 2),
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
        if (error.errors.length < taskList.length) {
          writeFileSync(
            flags['state-file'],
            JSON.stringify(stateRoot, null, 2),
            'utf-8',
          );
          this.log(
            `\n${chalk.yellow('✔')} Partially conserved, with ${chalk.red(
              `${error.errors.length} error(s)`,
            )}.`,
          );
        } else {
          this.log(
            `\n${chalk.red('✖')} All ${chalk.red(
              `${taskList.length} tricks failed`,
            )} with errors.`,
          );
        }
      });
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
      enabledTricks = enabledTricks.filter(disabledTrickName =>
        flags['ignore-trick'].includes(disabledTrickName),
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

  private printBanner(awsConfig: AWS.Config, flags: Record<string, any>) {
    const awsRegion = awsConfig.region || flags.region;
    const awsProfile = (awsConfig.credentials as any).profile || flags.profile;

    this.log(`
AWS Cost Saver
--------------
  Action: ${chalk.green('conserve')}
  AWS region: ${chalk.green(awsRegion)}
  AWS profile: ${chalk.green(awsProfile)}
  State file: ${
    flags['no-state-file']
      ? chalk.yellow('none')
      : chalk.green(flags['state-file'])
  }
  Dry run: ${flags['dry-run'] ? chalk.green('yes') : chalk.yellow('no')}
`);
  }

  private async validateStateFilePath(flags: Record<string, any>) {
    if (!flags['no-state-file'] && existsSync(flags['state-file'])) {
      this.log(
        chalk.yellow(
          `\n→ State file already exists: ${chalk.yellowBright(
            flags['state-file'],
          )}\n`,
        ),
      );
      const answers = await inquirer.prompt([
        {
          name: 'stateFileOverwrite',
          type: 'confirm',
          default: false,
          message: `Are you sure you want to ${chalk.bgRed(
            chalk.white('OVERWRITE'),
          )} existing state-file?\n  You will not be able to restore to previously conserved resources!`,
        },
      ]);

      if (!answers.stateFileOverwrite) {
        this.log(
          chalk.redBright('\nIgnoring, to avoid overwriting state file!\n'),
        );

        throw new Error('AbortedByUser');
      }
    }
  }
}
