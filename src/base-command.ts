import AWS from 'aws-sdk';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { existsSync } from 'fs';
import { Command } from '@oclif/command';
import { Task } from 'listr2/dist/lib/task';
import { ListrTaskObject } from 'listr2';
import figures from 'figures';

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

    if (flags['only-summary']) {
      this.consoleWriteLine(
        `${chalk.green(
          figures.pointer,
        )} running in the background, summary will be printed at the end...`,
      );
      this.consoleWriteLine();
    }
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

  protected collectErrors(tasks: ListrTaskObject<any, any>[]): string[] {
    return tasks
      .map((task: Task<any, any> | ListrTaskObject<any, any>):
        | string
        | undefined => {
        const errors: (string | undefined)[] =
          task.subtasks && task.subtasks.length > 0
            ? this.collectErrors(task.subtasks)
            : [];

        if (task.hasFailed() || task.state === 'FAILED') {
          errors.unshift(task.message.error || task.title);
        }

        const filtered = errors.filter(e => e !== undefined);

        return filtered.length > 0 ? filtered.join(' ') : undefined;
      })
      .filter(e => e !== undefined) as string[];
  }

  protected renderSummary(
    tasks: Task<any, any>[] | ListrTaskObject<any, any>[],
    level = 0,
  ) {
    for (const task of tasks) {
      if (task.cleanTitle?.toString().includes('fetch current state')) {
        continue;
      }

      if (!task.cleanTitle?.toString().includes('conserve resources')) {
        this.consoleWriteLine(
          `${' '.repeat(level)}${
            task.isSkipped()
              ? chalk.yellow(figures.arrowDown)
              : chalk.green(level === 0 ? figures.circleDouble : figures.tick)
          } ${task.cleanTitle}`,
        );
      }

      if (task.output) {
        this.consoleWriteLine(`${' '.repeat(level)}${chalk.gray(task.output)}`);
      }

      if (task.message) {
        if (task.message.error)
          this.consoleWriteLine(
            `${' '.repeat(level)} ${chalk.red(
              `${figures.cross} ${task.message.error}`,
            )}`,
          );
        if (task.message.skip)
          this.consoleWriteLine(
            `${' '.repeat(level)} ${chalk.gray(
              `${figures.arrowDown} ${task.message.skip}`,
            )}`,
          );
      }

      if (task.subtasks) {
        this.renderSummary(task.subtasks, level + 1);
      }

      if (level === 0) {
        this.consoleWriteLine();
      }
    }
  }

  protected consoleWriteLine(message?: string) {
    process.stdout.write(`${message || ''}\n`);
  }
}
