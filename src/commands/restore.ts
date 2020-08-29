import AWS from 'aws-sdk';
import chalk from 'chalk';
import { readFileSync } from 'fs';
import { Command, flags } from '@oclif/command';
import Listr, { ListrOptions, ListrTask } from 'listr';

import { TrickRegistry } from '../tricks/trick-registry';
import { configureAWS } from '../configure-aws';
import { RootState } from '../interfaces/root-state';
import { TrickOptionsInterface } from '../interfaces/trick-options.interface';

export default class Restore extends Command {
  static description =
    'To restore AWS resources stopped by the conserve command.';

  static examples = [
    `$ aws-cost-saver restore`,
    `$ aws-cost-saver restore ${chalk.yellow('--dry-run')}`,
    `$ aws-cost-saver restore ${chalk.yellow(
      `--region ${chalk.bold(`eu-central-1`)} --profile ${chalk.bold(
        `my-aws-profile`,
      )}`,
    )}`,
    `$ aws-cost-saver restore ${chalk.yellow(
      `--state-file ${chalk.bold(`another-path.json`)}`,
    )}`,
  ];

  static flags = {
    help: flags.help({ char: 'h' }),
    region: flags.string({ char: 'r', default: 'eu-central-1' }),
    profile: flags.string({ char: 'p', default: 'default' }),
    'dry-run': flags.boolean({
      char: 'd',
      description: 'Only print actions but do not do them',
    }),
    'state-file': flags.string({
      char: 's',
      default: 'aws-cost-saver.json',
      description:
        'Path to state-file which contains original state of AWS resources to restore to.',
    }),
  };

  async run() {
    const { flags } = this.parse(Restore);

    const awsConfig = await configureAWS(flags.profile, flags.region);

    this.printBanner(awsConfig, flags);

    const tricksRegistry = TrickRegistry.initialize();
    const stateContent = readFileSync(flags['state-file'], 'utf-8');
    const rootState: RootState = JSON.parse(stateContent.toString());
    const taskList: ListrTask[] = [];
    const options: TrickOptionsInterface = {
      dryRun: flags['dry-run'],
    };

    for (const trick of tricksRegistry.all()) {
      taskList.push({
        title: `${trick.getRestoreTitle()}`,
        task: async (ctx, task) => {
          if (!rootState[trick.getMachineName()]) {
            return task.skip('Nothing was conserved previously.');
          }

          return trick
            .restore(task, rootState[trick.getMachineName()], options)
            .catch(task.report);
        },
        exitOnError: false,
        collapse: false,
      } as ListrTask);
    }

    await new Listr<RootState>(taskList, {
      concurrent: true,
      exitOnError: false,
      collapse: false,
    } as ListrOptions)
      .run()
      .then(() => {
        if (flags['dry-run']) {
          this.log(`\n${chalk.yellow(' ↓ Skipped restore due to dry-run.')}`);
        } else {
          this.log(
            `\n ${chalk.green(
              '✔',
            )} Successfully restored state from ${chalk.green(
              flags['state-file'],
            )}`,
          );
        }
      })
      .catch(error => {
        this.log(
          `\n${chalk.yellow('✔')} Partially restored, with ${chalk.red(
            `${error.errors.length} errors`,
          )}.`,
        );
      });
  }

  private printBanner(awsConfig: AWS.Config, flags: Record<string, any>) {
    const awsRegion = awsConfig.region || flags.region;
    const awsProfile = (awsConfig.credentials as any).profile || flags.profile;

    this.log(`
AWS Cost Saver
--------------
  Action: ${chalk.green('restore')}
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
}
