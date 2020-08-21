import AWS from 'aws-sdk';
import Listr, { ListrTaskWrapper } from 'listr';
import chalk from 'chalk';

import { TrickInterface } from '../interfaces/trick.interface';
import { RdsDatabaseState } from '../states/rds-database.state';

export type StopRdsDatabaseInstancesState = RdsDatabaseState[];

export class StopRdsDatabaseInstancesTrick
  implements TrickInterface<StopRdsDatabaseInstancesState> {
  private rdsClient: AWS.RDS;

  constructor() {
    this.rdsClient = new AWS.RDS();
  }

  getMachineName(): string {
    return 'stop-rds-database-instances';
  }

  getDisplayName(): string {
    return 'Stop RDS Database Instances';
  }

  async conserve(
    subListr: Listr,
    dryRun: boolean,
  ): Promise<StopRdsDatabaseInstancesState> {
    const databases = await this.listDatabases();
    const currentState = await this.getCurrentState(databases);

    if (currentState.length > 0) {
      for (const database of currentState) {
        subListr.add({
          title: chalk.blueBright(database.identifier),
          task: (ctx, task) => this.conserveDatabase(task, dryRun, database),
        });
      }
    }

    return currentState;
  }

  async restore(
    subListr: Listr,
    dryRun: boolean,
    originalState: StopRdsDatabaseInstancesState,
  ): Promise<void> {
    for (const database of originalState) {
      subListr.add({
        title: chalk.blueBright(database.identifier),
        task: (ctx, task) => this.restoreDatabase(task, dryRun, database),
      });
    }
  }

  private async conserveDatabase(
    task: ListrTaskWrapper,
    dryRun: boolean,
    databaseState: RdsDatabaseState,
  ): Promise<void> {
    if (dryRun) {
      task.skip('Skipped due to dry-run');
    } else if (
      databaseState.status !== 'stopping' &&
      databaseState.status !== 'stopped'
    ) {
      await this.rdsClient
        .stopDBInstance({
          DBInstanceIdentifier: databaseState.identifier,
        })
        .promise();
      task.output = 'Stopped successfully';
    } else {
      task.skip('Already stopped');
    }
  }

  private async restoreDatabase(
    task: ListrTaskWrapper,
    dryRun: boolean,
    databaseState: RdsDatabaseState,
  ): Promise<void> {
    if (dryRun) {
      task.skip('Skipped due to dry-run');
    } else {
      await this.rdsClient
        .startDBInstance({
          DBInstanceIdentifier: databaseState.identifier,
        })
        .promise();
      task.output = 'Started successfully';
    }
  }

  private async getCurrentState(databases: AWS.RDS.DBInstanceList) {
    return Promise.all(
      databases.map(
        async (database): Promise<RdsDatabaseState> => {
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

          return {
            identifier: database.DBInstanceIdentifier,
            status: database.DBInstanceStatus,
          };
        },
      ),
    );
  }

  private async listDatabases() {
    return (
      (await this.rdsClient.describeDBInstances().promise()).DBInstances || []
    );
  }
}
