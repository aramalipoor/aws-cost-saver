import AWS from 'aws-sdk';
import chalk from 'chalk';
import { Listr, ListrTask, ListrTaskWrapper } from 'listr2';
import { TagFilterList } from 'aws-sdk/clients/resourcegroupstaggingapi';

import { TrickInterface } from '../types/trick.interface';
import { TrickOptionsInterface } from '../types/trick-options.interface';

import { RdsDatabaseState } from '../states/rds-database.state';
import { TrickContext } from '../types/trick-context';

export type StopRdsDatabaseInstancesState = RdsDatabaseState[];

export class StopRdsDatabaseInstancesTrick
  implements TrickInterface<StopRdsDatabaseInstancesState> {
  static machineName = 'stop-rds-database-instances';

  private rdsClient: AWS.RDS;

  constructor() {
    this.rdsClient = new AWS.RDS();
  }

  getMachineName(): string {
    return StopRdsDatabaseInstancesTrick.machineName;
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
    currentState: StopRdsDatabaseInstancesState,
    options: TrickOptionsInterface,
  ): Promise<Listr> {
    const databases = await this.listDatabases(task, options);

    const subListr = task.newListr([], {
      concurrent: 10,
      exitOnError: false,
      rendererOptions: {
        collapse: true,
      },
    });

    if (!databases || databases.length === 0) {
      task.skip(chalk.dim('no RDS databases found'));
      return subListr;
    }

    subListr.add(
      databases.map(
        (database): ListrTask => {
          return {
            title:
              database.DBInstanceIdentifier || chalk.italic('<no-identifier>'),
            task: async () => {
              if (database.DBInstanceIdentifier === undefined) {
                throw new Error(
                  `Unexpected error: DBInstanceIdentifier is missing for RDS database`,
                );
              }

              if (database.DBInstanceStatus === undefined) {
                throw new Error(
                  `Unexpected error: DBInstanceStatus is missing for RDS database`,
                );
              }

              currentState.push({
                identifier: database.DBInstanceIdentifier,
                status: database.DBInstanceStatus,
              });
            },
          };
        },
      ),
    );

    return subListr;
  }

  async conserve(
    task: ListrTaskWrapper<any, any>,
    currentState: StopRdsDatabaseInstancesState,
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
      for (const database of currentState) {
        subListr.add({
          title: chalk.blue(`${database.identifier}`),
          task: (ctx, task) => this.conserveDatabase(task, database, options),
          options: {
            persistentOutput: true,
          },
        });
      }
    } else {
      task.skip(chalk.dim(`no RDS databases found`));
    }

    return subListr;
  }

  async restore(
    task: ListrTaskWrapper<any, any>,
    originalState: StopRdsDatabaseInstancesState,
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
      for (const database of originalState) {
        subListr.add({
          title: chalk.blue(`${database.identifier}`),
          task: (ctx, task) => this.restoreDatabase(task, database, options),
          options: {
            persistentOutput: true,
          },
        });
      }
    } else {
      task.skip(chalk.dim(`no RDS databases was conserved`));
    }

    return subListr;
  }

  private async conserveDatabase(
    task: ListrTaskWrapper<any, any>,
    databaseState: RdsDatabaseState,
    options: TrickOptionsInterface,
  ): Promise<void> {
    if (databaseState.status !== 'available') {
      task.skip(
        chalk.dim(
          `skipped, current state is not "available" it is "${databaseState.status}" instead`,
        ),
      );
      return;
    }

    if (options.dryRun) {
      task.skip(chalk.dim('skipped, would stop the RDS instance'));
      return;
    }

    await this.rdsClient
      .stopDBInstance({
        DBInstanceIdentifier: databaseState.identifier,
      })
      .promise();
    // TODO Find a way to wait for "stopped" state

    task.output = 'stopped successfully';
  }

  private async restoreDatabase(
    task: ListrTaskWrapper<any, any>,
    databaseState: RdsDatabaseState,
    options: TrickOptionsInterface,
  ): Promise<void> {
    if (databaseState.status !== 'available') {
      task.skip(
        chalk.dim(
          `skipped, previous state was not "available" it was "${databaseState.status}" instead`,
        ),
      );
      return;
    }

    if (options.dryRun) {
      task.skip(chalk.dim('skipped, would start RDS instance'));
      return;
    }

    try {
      task.output = 'starting RDS instance...';
      await this.rdsClient
        .startDBInstance({
          DBInstanceIdentifier: databaseState.identifier,
        })
        .promise();

      task.output = 'waiting for RDS instance to be available...';
      await this.rdsClient
        .waitFor('dBInstanceAvailable', {
          DBInstanceIdentifier: databaseState.identifier,
        })
        .promise();

      task.output = 'started successfully';
    } catch (error) {
      if (error.code === 'InvalidDBInstanceState') {
        task.skip(chalk.dim('skipped, database is not in "stopped" state.'));
        return;
      }

      throw error;
    }
  }

  private async listDatabases(
    task: ListrTaskWrapper<any, any>,
    options: TrickOptionsInterface,
  ): Promise<AWS.RDS.DBInstanceList> {
    const databases: AWS.RDS.DBInstanceList = [];

    // TODO Add logic to go through all pages
    task.output = 'fetching page 1...';
    databases.push(
      ...(
        (
          await this.rdsClient
            .describeDBInstances({
              Filters:
                options.tags &&
                StopRdsDatabaseInstancesTrick.prepareFilters(options.tags),
              MaxRecords: 100,
            })
            .promise()
        ).DBInstances || []
      ).filter(instance => !instance.DBClusterIdentifier),
    );

    task.output = 'done';
    return databases;
  }

  private static prepareFilters(tags: TagFilterList): AWS.RDS.FilterList {
    return tags.map(t => ({ Name: `tag:${t.Key}`, Values: t.Values || [] }));
  }
}
