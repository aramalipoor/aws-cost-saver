import AWS from 'aws-sdk';
import chalk from 'chalk';
import { Listr, ListrTask, ListrTaskWrapper } from 'listr2';

import { TrickInterface } from '../interfaces/trick.interface';
import { TrickOptionsInterface } from '../interfaces/trick-options.interface';

import { RdsClusterState } from '../states/rds-cluster.state';

export type StopRdsDatabaseClustersState = RdsClusterState[];

export class StopRdsDatabaseClustersTrick
  implements TrickInterface<StopRdsDatabaseClustersState> {
  private rdsClient: AWS.RDS;

  static machineName = 'stop-rds-database-clusters';

  constructor() {
    this.rdsClient = new AWS.RDS();
  }

  getMachineName(): string {
    return StopRdsDatabaseClustersTrick.machineName;
  }

  async getCurrentState(
    task: ListrTaskWrapper<any, any>,
    currentState: StopRdsDatabaseClustersState,
    options: TrickOptionsInterface,
  ): Promise<Listr> {
    const clusters = await this.listClusters(task);

    const subListr = task.newListr([], {
      concurrent: 10,
      exitOnError: false,
      rendererOptions: {
        collapse: true,
      },
    });

    if (!clusters || clusters.length === 0) {
      task.skip(chalk.dim('no RDS clusters found'));
      return subListr;
    }

    subListr.add(
      clusters.map(
        (cluster): ListrTask => {
          return {
            title:
              cluster.DBClusterIdentifier || chalk.italic('<no-identifier>'),
            task: async () => {
              if (cluster.DBClusterIdentifier === undefined) {
                throw new Error(
                  `Unexpected error: DBClusterIdentifier is missing for RDS cluster`,
                );
              }

              if (cluster.Status === undefined) {
                throw new Error(
                  `Unexpected error: Status is missing for RDS cluster`,
                );
              }

              currentState.push({
                identifier: cluster.DBClusterIdentifier,
                status: cluster.Status,
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
    currentState: StopRdsDatabaseClustersState,
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
          title: chalk.greenBright(`${database.identifier}`),
          task: (ctx, task) => this.conserveCluster(task, database, options),
          options: {
            persistentOutput: true,
          },
        });
      }
    } else {
      task.skip(chalk.dim(`no RDS clusters found`));
    }

    return subListr;
  }

  async restore(
    task: ListrTaskWrapper<any, any>,
    originalState: StopRdsDatabaseClustersState,
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
      for (const cluster of originalState) {
        subListr.add({
          title: chalk.greenBright(`${cluster.identifier}`),
          task: (ctx, task) => this.restoreCluster(task, cluster, options),
          options: {
            persistentOutput: true,
          },
        });
      }
    } else {
      task.skip(chalk.dim(`no RDS clusters was conserved`));
    }

    return subListr;
  }

  private async conserveCluster(
    task: ListrTaskWrapper<any, any>,
    clusterState: RdsClusterState,
    options: TrickOptionsInterface,
  ): Promise<void> {
    if (clusterState.status !== 'available') {
      task.skip(
        chalk.dim(
          `skipped, current state is not "available" it is "${clusterState.status}" instead`,
        ),
      );
      return;
    }

    if (options.dryRun) {
      task.skip(chalk.dim('skipped, would stop the RDS cluster'));
      return;
    }

    await this.rdsClient
      .stopDBCluster({
        DBClusterIdentifier: clusterState.identifier,
      })
      .promise();
    // TODO Find a way to wait for "stopped" state

    task.output = 'stopped successfully';
  }

  private async restoreCluster(
    task: ListrTaskWrapper<any, any>,
    clusterState: RdsClusterState,
    options: TrickOptionsInterface,
  ): Promise<void> {
    if (clusterState.status !== 'available') {
      task.skip(
        chalk.dim(
          `skipped, previous state was not "available" it was "${clusterState.status}" instead`,
        ),
      );
      return;
    }

    if (options.dryRun) {
      task.skip(chalk.dim('skipped, would start RDS cluster'));
      return;
    }

    try {
      task.output = 'starting RDS cluster...';
      await this.rdsClient
        .startDBCluster({
          DBClusterIdentifier: clusterState.identifier,
        })
        .promise();

      task.output = 'waiting for instances to be available...';
      await this.rdsClient
        .waitFor('dBInstanceAvailable', {
          Filters: [
            { Name: 'db-cluster-id', Values: [clusterState.identifier] },
          ],
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

  private async listClusters(
    task: ListrTaskWrapper<any, any>,
  ): Promise<AWS.RDS.DBClusterList> {
    const clusters: AWS.RDS.DBClusterList = [];

    // TODO Add logic to go through all pages
    task.output = 'fetching page 1...';
    clusters.push(
      ...(((
        await this.rdsClient
          .describeDBClusters({
            MaxRecords: 100,
          })
          .promise()
      ).DBClusters as AWS.RDS.DBClusterList) || []),
    );

    task.output = 'done';
    return clusters;
  }
}
