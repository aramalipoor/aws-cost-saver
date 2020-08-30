import AWS from 'aws-sdk';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { existsSync } from 'fs';
import { Command } from '@oclif/command';

export default abstract class BaseCommand extends Command {
  protected printBanner(awsConfig: AWS.Config, flags: Record<string, any>) {
    const awsRegion = awsConfig.region || flags.region;
    const awsProfile = (awsConfig.credentials as any).profile || flags.profile;

    this.log(`
AWS Cost Saver
--------------
  Action: ${chalk.green(this.constructor.name)}
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

  protected async validateStateFilePath(flags: Record<string, any>) {
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
          chalk.redBright(
            '\nIgnoring, to avoid overwriting state file! Use -n|--no-state-file flag to skip writing the state file.\n',
          ),
        );

        throw new Error('AbortedByUser');
      }
    }
  }
}
