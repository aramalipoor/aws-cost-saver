import AWS from 'aws-sdk';
import chalk from 'chalk';
import Listr, { ListrOptions, ListrTask, ListrTaskWrapper } from 'listr';

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

  getConserveTitle(): string {
    return 'Stop RDS Database Clusters';
  }

  getRestoreTitle(): string {
    return 'Start RDS Database Clusters';
  }

  async getCurrentState(
    task: ListrTaskWrapper,
    currentState: StopRdsDatabaseClustersState,
    options: TrickOptionsInterface,
  ): Promise<Listr> {
    const clusters = await this.listClusters(task);

    const subListr = new Listr({
      concurrent: true,
      exitOnError: false,
      collapse: false,
    } as ListrOptions);

    if (!clusters || clusters.length === 0) {
      task.skip('No RDS clusters found');
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
    task: ListrTaskWrapper,
    currentState: StopRdsDatabaseClustersState,
    options: TrickOptionsInterface,
  ): Promise<Listr> {
    const subListr = new Listr({
      concurrent: 10,
      exitOnError: false,
      collapse: false,
    } as ListrOptions);

    if (currentState && currentState.length > 0) {
      for (const database of currentState) {
        subListr.add({
          title: chalk.blueBright(`${database.identifier}`),
          task: (ctx, task) => this.conserveCluster(task, database, options),
        });
      }
    } else {
      task.skip(`No RDS clusters found`);
    }

    return subListr;
  }

  async restore(
    task: ListrTaskWrapper,
    originalState: StopRdsDatabaseClustersState,
    options: TrickOptionsInterface,
  ): Promise<Listr> {
    const subListr = new Listr({
      concurrent: 10,
      exitOnError: false,
      collapse: false,
    } as ListrOptions);

    if (originalState && originalState.length > 0) {
      for (const cluster of originalState) {
        subListr.add({
          title: chalk.blueBright(`${cluster.identifier}`),
          task: (ctx, task) => this.restoreCluster(task, cluster, options),
        });
      }
    } else {
      task.skip(`No RDS clusters was conserved`);
    }

    return subListr;
  }

  private async conserveCluster(
    task: ListrTaskWrapper,
    clusterState: RdsClusterState,
    options: TrickOptionsInterface,
  ): Promise<void> {
    if (clusterState.status !== 'available') {
      task.skip(
        `Skipped, current state is not "available" it is "${clusterState.status}" instead`,
      );
      return;
    }

    if (options.dryRun) {
      task.skip('Skipped, would stop the RDS cluster');
      return;
    }

    await this.rdsClient
      .stopDBCluster({
        DBClusterIdentifier: clusterState.identifier,
      })
      .promise();
    // TODO Find a way to wait for "stopped" state

    task.output = 'Stopped successfully';
  }

  private async restoreCluster(
    task: ListrTaskWrapper,
    clusterState: RdsClusterState,
    options: TrickOptionsInterface,
  ): Promise<void> {
    if (clusterState.status !== 'available') {
      task.skip(
        `Skipped, previous state was not "available" it was "${clusterState.status}" instead`,
      );
      return;
    }

    if (options.dryRun) {
      task.skip('Skipped, would start RDS cluster');
      return;
    }

    try {
      task.output = 'Starting RDS cluster...';
      await this.rdsClient
        .startDBCluster({
          DBClusterIdentifier: clusterState.identifier,
        })
        .promise();

      task.output = 'Waiting for instances to be available...';
      await this.rdsClient
        .waitFor('dBInstanceAvailable', {
          Filters: [
            { Name: 'db-cluster-id', Values: [clusterState.identifier] },
          ],
        })
        .promise();

      task.output = 'Started successfully';
    } catch (error) {
      if (error.code === 'InvalidDBInstanceState') {
        task.skip('Skipped, database is not in "stopped" state.');
        return;
      }

      throw error;
    }
  }

  private async listClusters(
    task: ListrTaskWrapper,
  ): Promise<AWS.RDS.DBClusterList> {
    const clusters: AWS.RDS.DBClusterList = [];

    // TODO Add logic to go through all pages
    task.output = 'Fetching page 1...';
    clusters.push(
      ...(((
        await this.rdsClient
          .describeDBClusters({
            MaxRecords: 100,
          })
          .promise()
      ).DBClusters as AWS.RDS.DBClusterList) || []),
    );

    return clusters;
  }
}
