import { Command, flags } from '@oclif/command';
import { readFileSync } from 'fs';

import { TrickRegistry } from '../tricks/trick-registry';
import { configureAWS } from '../aws-configure';
import chalk from 'chalk';
import Listr, { ListrTask } from 'listr';

export default class Restore extends Command {
  static description =
    'To restore AWS resources stopped by the conserve command.';

  static examples = [
    `$ aws-cost-saver restore`,
    `$ aws-cost-saver restore --dry-run`,
    `$ aws-cost-saver restore --region eu-central-1 --profile my-aws-profile`,
    `$ aws-cost-saver restore --state-file new-path.json`,
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

    const awsRegion = awsConfig.region;
    const awsProfile = (awsConfig.credentials as any)?.profile || flags.profile;

    this.log(`
AWS Cost Saver
--------------
  Action: ${chalk.green('restore')}
  AWS region: ${chalk.green(awsRegion)}
  AWS profile: ${chalk.green(awsProfile)}
  State file: ${chalk.green(flags['state-file'])}
`);

    const tricksRegistry = TrickRegistry.initialize();
    const stateContent = readFileSync(flags['state-file'], 'utf-8');
    const rootState = JSON.parse(stateContent);
    const taskList: ListrTask[] = [];

    for (const trick of tricksRegistry.all()) {
      taskList.push({
        title: `${trick.getDisplayName()}`,
        task: async (ctx, task) => {
          const subListr = new Listr([], {
            concurrent: false,
            exitOnError: false,
            // @ts-ignore
            collapse: false,
          });

          if (rootState[trick.getMachineName()]) {
            await trick
              .restore(
                subListr,
                flags['dry-run'],
                rootState[trick.getMachineName()],
              )
              .catch(task.report);
          } else {
            task.skip('Nothing was conserved previously.');
          }

          return subListr;
        },
        exitOnError: false,
        // @ts-ignore
        collapse: false,
      } as ListrTask);
    }

    await new Listr(taskList, {
      concurrent: true,
      renderer: 'default',
      exitOnError: false,
      // @ts-ignore
      collapse: false,
    })
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
}
