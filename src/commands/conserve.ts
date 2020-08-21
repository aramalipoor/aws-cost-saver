import Command, { flags } from '@oclif/command';
import { writeFileSync, existsSync } from 'fs';
import Listr, { ListrTask } from 'listr';
import inquirer from 'inquirer';

import { TrickRegistry } from '../tricks/trick-registry';
import { configureAWS } from '../aws-configure';
import chalk from 'chalk';

export default class Conserve extends Command {
  static description =
    'This command uses various tricks to conserve as much money as possible. To restore, this command will create a `aws-cost-saver-state.json` file to be use by "restore"';

  static examples = [
    `$ aws-cost-saver conserve`,
    `$ aws-cost-saver conserve --dry-run`,
    `$ aws-cost-saver conserve --region eu-central-1 --profile my-aws-profile`,
    `$ aws-cost-saver conserve --state-file new-path.json`,
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
        'Where to keep original state of stopped resources to restore later.',
    }),
  };

  static args = [];

  async run() {
    const { flags } = this.parse(Conserve);

    const awsConfig = await configureAWS(flags.profile, flags.region);

    if (!flags['dry-run'] && existsSync(flags['state-file'])) {
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
          chalk.redBright('Ignoring converse to avoid overwriting state file!'),
        );
        return;
      }
    }

    const awsRegion = awsConfig.region;
    const awsProfile = (awsConfig.credentials as any)?.profile || flags.profile;

    this.log(`
AWS Cost Saver
--------------
  Action: ${chalk.green('conserve')}
  AWS Region: ${chalk.green(awsRegion)}
  AWS Profile: ${chalk.green(awsProfile)}
`);

    const tricksRegistry = TrickRegistry.initialize();
    const taskList: ListrTask[] = [];
    const stateRoot: any = {};

    for (const trick of tricksRegistry.all()) {
      taskList.push({
        title: `${trick.getDisplayName()}`,
        task: async (ctx, task) => {
          const subListr = new Listr([], {
            concurrent: false,
            // eslint-disable-next-line @typescript-eslint/ban-ts-ignore
            // @ts-ignore
            collapse: false,
          });

          await trick
            .conserve(subListr, flags['dry-run'])
            .then(result => {
              stateRoot[trick.getMachineName()] = result;

              if (Array.isArray(result) && result.length === 0) {
                task.skip('No resources found');
              }
            })
            .catch(task.report);

          return subListr;
        },
        // eslint-disable-next-line @typescript-eslint/ban-ts-ignore
        // @ts-ignore
        collapse: false,
      });
    }

    await new Listr(taskList, {
      concurrent: true,
      // eslint-disable-next-line @typescript-eslint/ban-ts-ignore
      // @ts-ignore
      collapse: false,
    })
      .run()
      .then(() => {
        if (flags['dry-run']) {
          this.log(
            `\n${chalk.yellow(' ↓ Skipped saving state due to dry-run.')}`,
          );
        } else {
          writeFileSync(
            flags['state-file'],
            JSON.stringify(stateRoot, null, 2),
            'utf-8',
          );
          this.log(
            `\n ${chalk.green('✔')} Successfully saved state: ${chalk.green(
              flags['state-file'],
            )}`,
          );
        }
      });
  }
}
