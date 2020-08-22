import Command, { flags } from '@oclif/command';
import { writeFileSync, existsSync } from 'fs';
import Listr, { ListrTask, ListrTaskWrapper } from 'listr';
import inquirer from 'inquirer';

import { TrickRegistry } from '../tricks/trick-registry';
import { configureAWS } from '../aws-configure';
import chalk from 'chalk';

export default class Conserve extends Command {
  static description =
    'This command uses various tricks to conserve as much money as possible. To restore, this command will create a `aws-cost-saver.json` file to be use by "restore"';

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
        'Where to keep original state of stopped/decreased resources to restore later.',
    }),
    'no-state-file': flags.boolean({
      char: 'n',
      default: false,
      description:
        'Ignore saving original state, just try to conserve as much money as possible.',
    }),
  };

  static args = [];

  async run() {
    const { flags } = this.parse(Conserve);

    const awsConfig = await configureAWS(flags.profile, flags.region);

    if (
      !flags['dry-run'] &&
      !flags['no-state-file'] &&
      existsSync(flags['state-file'])
    ) {
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
          chalk.redBright('\nIgnoring, to avoid overwriting state file!'),
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
  AWS region: ${chalk.green(awsRegion)}
  AWS profile: ${chalk.green(awsProfile)}
  State file: ${
    flags['no-state-file']
      ? chalk.yellow('none')
      : chalk.green(flags['state-file'])
  }
  Dry run: ${flags['dry-run'] ? chalk.green('yes') : chalk.yellow('no')}
`);

    const tricksRegistry = TrickRegistry.initialize();
    const taskList: ListrTask[] = [];
    const stateRoot: any = {};

    for (const trick of tricksRegistry.all()) {
      taskList.push({
        title: `${trick.getDisplayName()}`,
        task: async (ctx, task: ListrTaskWrapper<any>) => {
          const subListr = new Listr([], {
            concurrent: false,
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
        if (!flags['dry-run'] && !flags['no-state-file']) {
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
}
