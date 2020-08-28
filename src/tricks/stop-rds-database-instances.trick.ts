import AWS from 'aws-sdk';
import chalk from 'chalk';
import Listr, { ListrTask, ListrTaskWrapper } from 'listr';

import { TrickInterface } from '../interfaces/trick.interface';
import { RdsDatabaseState } from '../states/rds-database.state';

export type StopRdsDatabaseInstancesState = RdsDatabaseState[];

export class StopRdsDatabaseInstancesTrick
  implements TrickInterface<StopRdsDatabaseInstancesState> {
  private rdsClient: AWS.RDS;

  static machineName = 'stop-rds-database-instances';

  constructor() {
    this.rdsClient = new AWS.RDS();
  }

  getMachineName(): string {
    return StopRdsDatabaseInstancesTrick.machineName;
  }

  getConserveTitle(): string {
    return 'Stop RDS Database Instances';
  }

  getRestoreTitle(): string {
    return 'Start RDS Database Instances';
  }

  async getCurrentState(
    task: ListrTaskWrapper,
    currentState: StopRdsDatabaseInstancesState,
  ): Promise<Listr> {
    const databases = await this.listDatabases(task);

    if (!databases || databases.length === 0) {
      task.skip('No RDS databases found');
      return;
    }

    const subListr = new Listr({
      concurrent: true,
      exitOnError: false,
      // @ts-ignore
      collapse: false,
    });

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
    task: ListrTaskWrapper,
    currentState: StopRdsDatabaseInstancesState,
    dryRun: boolean,
  ): Promise<Listr> {
    const subListr = new Listr({
      concurrent: 10,
      exitOnError: false,
      // @ts-ignore
      collapse: false,
    });

    if (currentState && currentState.length > 0) {
      for (const database of currentState) {
        subListr.add({
          title: chalk.blueBright(`${database.identifier}`),
          task: (ctx, task) => this.conserveDatabase(task, database, dryRun),
        });
      }
    } else {
      task.skip(`No RDS databases found`);
    }

    return subListr;
  }

  async restore(
    task: ListrTaskWrapper,
    originalState: StopRdsDatabaseInstancesState,
    dryRun: boolean,
  ): Promise<Listr> {
    const subListr = new Listr({
      concurrent: 10,
      exitOnError: false,
      // @ts-ignore
      collapse: false,
    });

    if (originalState && originalState.length > 0) {
      for (const database of originalState) {
        subListr.add({
          title: chalk.blueBright(`${database.identifier}`),
          task: (ctx, task) => this.restoreDatabase(task, database, dryRun),
        });
      }
    } else {
      task.skip(`No RDS databases was conserved`);
    }

    return subListr;
  }

  private async conserveDatabase(
    task: ListrTaskWrapper,
    databaseState: RdsDatabaseState,
    dryRun: boolean,
  ): Promise<void> {
    if (databaseState.status !== 'available') {
      task.skip(
        `Skipped, current state is not "available" it is "${databaseState.status}" instead`,
      );
      return;
    }

    if (dryRun) {
      task.skip('Skipped, would stop the RDS instance');
      return;
    }

    await this.rdsClient
      .stopDBInstance({
        DBInstanceIdentifier: databaseState.identifier,
      })
      .promise();
    // TODO Find a way to wait for "stopped" state

    task.output = 'Stopped successfully';
  }

  private async restoreDatabase(
    task: ListrTaskWrapper,
    databaseState: RdsDatabaseState,
    dryRun: boolean,
  ): Promise<void> {
    if (databaseState.status !== 'available') {
      task.skip(
        `Skipped, previous state was not "available" it was "${databaseState.status}" instead`,
      );
      return;
    }

    if (dryRun) {
      task.skip('Skipped, would start RDS instance');
      return;
    }

    try {
      task.output = 'Starting RDS instance...';
      await this.rdsClient
        .startDBInstance({
          DBInstanceIdentifier: databaseState.identifier,
        })
        .promise();

      task.output = 'Waiting for RDS instance to be available...';
      await this.rdsClient
        .waitFor('dBInstanceAvailable', {
          DBInstanceIdentifier: databaseState.identifier,
        })
        .promise();

      task.output = 'Started successfully';
    } catch (error) {
      if (error.code === 'InvalidDBInstanceState') {
        task.skip('Skipped, database is not in "stopped" state.');
      }

      throw error;
    }
  }

  private async listDatabases(
    task: ListrTaskWrapper,
  ): Promise<AWS.RDS.DBInstanceList> {
    const databases: AWS.RDS.DBInstanceList = [];

    // TODO Add logic to go through all pages
    task.output = 'Fetching page 1...';
    databases.push(
      ...((
        await this.rdsClient.describeDBInstances({ MaxRecords: 100 }).promise()
      ).DBInstances || []),
    );

    return databases;
  }
}
