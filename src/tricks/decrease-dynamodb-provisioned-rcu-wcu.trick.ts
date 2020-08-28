import AWS from 'aws-sdk';
import chalk from 'chalk';
import Listr, { ListrTask, ListrTaskWrapper } from 'listr';

import { TrickInterface } from '../interfaces/trick.interface';
import { DynamoDBTableState } from '../states/dynamodb-table.state';

export type DecreaseDynamoDBProvisionedRcuWcuState = DynamoDBTableState[];

export class DecreaseDynamoDBProvisionedRcuWcuTrick
  implements TrickInterface<DecreaseDynamoDBProvisionedRcuWcuState> {
  private ddbClient: AWS.DynamoDB;

  static machineName = 'decrease-dynamodb-provisioned-rcu-wcu';

  constructor() {
    this.ddbClient = new AWS.DynamoDB();
  }

  getMachineName(): string {
    return DecreaseDynamoDBProvisionedRcuWcuTrick.machineName;
  }

  getConserveTitle(): string {
    return 'Decrease DynamoDB Provisioned RCU and WCU';
  }

  getRestoreTitle(): string {
    return 'Restore DynamoDB Provisioned RCU and WCU';
  }

  async getCurrentState(
    task: ListrTaskWrapper,
    currentState: DecreaseDynamoDBProvisionedRcuWcuState,
  ): Promise<Listr> {
    const tableNames = await this.listTableNames(task);

    if (!tableNames || tableNames.length === 0) {
      task.skip('No DynamoDB tables found');
      return;
    }

    const subListr = new Listr({
      concurrent: 10,
      exitOnError: false,
      // @ts-ignore
      collapse: false,
    });

    subListr.add(
      tableNames.map(
        (tableName): ListrTask => {
          const tableState: DynamoDBTableState = {
            name: tableName,
          };
          currentState.push(tableState);
          return {
            title: tableName,
            task: async (ctx, task) => this.getTableState(task, tableState),
          };
        },
      ),
    );

    return subListr;
  }

  async conserve(
    task: ListrTaskWrapper,
    currentState: DecreaseDynamoDBProvisionedRcuWcuState,
    dryRun: boolean,
  ): Promise<Listr> {
    const subListr = new Listr({
      concurrent: 10,
      exitOnError: false,
      // @ts-ignore
      collapse: false,
    });

    if (currentState && currentState.length > 0) {
      for (const table of currentState) {
        subListr.add({
          title: `${chalk.blueBright(table.name)}`,
          task: (ctx, task) =>
            this.conserveTableProvisionedRcuWcu(task, table, dryRun),
        });
      }
    } else {
      task.skip(`No DynamoDB tables found`);
    }

    return subListr;
  }

  async restore(
    task: ListrTaskWrapper,
    currentState: DecreaseDynamoDBProvisionedRcuWcuState,
    dryRun: boolean,
  ): Promise<Listr> {
    const subListr = new Listr({
      concurrent: 10,
      exitOnError: false,
      // @ts-ignore
      collapse: false,
    });

    if (currentState && currentState.length > 0) {
      for (const table of currentState) {
        subListr.add({
          title: `${chalk.blueBright(table.name)}`,
          task: (ctx, task) =>
            this.restoreTableProvisionedRcuWcu(task, table, dryRun),
        });
      }
    } else {
      task.skip(`No DynamoDB tables was conserved`);
    }

    return subListr;
  }

  private async listTableNames(
    task: ListrTaskWrapper,
  ): Promise<AWS.DynamoDB.TableNameList> {
    const tableNames: string[] = [];

    // TODO Add logic to go through all pages
    task.output = 'Fetching page 1...';
    tableNames.push(
      ...((await this.ddbClient.listTables({ Limit: 100 }).promise())
        .TableNames || []),
    );

    return tableNames;
  }

  private async getTableState(
    task: ListrTaskWrapper,
    tableState: DynamoDBTableState,
  ): Promise<void> {
    task.output = 'Fetching table information...';
    const provisionedThroughput = (
      await this.ddbClient
        .describeTable({ TableName: tableState.name })
        .promise()
    ).Table?.ProvisionedThroughput;

    if (!provisionedThroughput) {
      tableState.provisionedThroughput = false;
      return;
    }

    tableState.provisionedThroughput = true;
    tableState.rcu = provisionedThroughput.ReadCapacityUnits;
    tableState.wcu = provisionedThroughput.WriteCapacityUnits;
  }

  private async conserveTableProvisionedRcuWcu(
    task: ListrTaskWrapper,
    tableState: DynamoDBTableState,
    dryRun: boolean,
  ): Promise<void> {
    if (!tableState.provisionedThroughput) {
      task.skip(`Provisioned throughput is not configured`);
      return;
    }

    if (tableState.wcu < 2 && tableState.rcu < 2) {
      task.skip(`Provisioned RCU/WCU is already at minimum of 1`);
      return;
    }

    if (dryRun) {
      task.skip('Skipped, would configure RCU = 1 WCU = 1');
      return;
    }

    task.output = `Configuring RCU = 1 WCU = 1 ...`;
    await this.ddbClient
      .updateTable({
        TableName: tableState.name,
        ProvisionedThroughput: {
          ReadCapacityUnits: 1,
          WriteCapacityUnits: 1,
        },
      })
      .promise();

    task.output = `Configured RCU = 1 WCU = 1`;
  }

  private async restoreTableProvisionedRcuWcu(
    task: ListrTaskWrapper,
    tableState: DynamoDBTableState,
    dryRun: boolean,
  ): Promise<void> {
    if (!tableState.provisionedThroughput) {
      task.skip(`Provisioned throughput was not configured`);
      return;
    }

    if (dryRun) {
      task.skip(
        `Skipped, would configure RCU = ${tableState.rcu} WCU = ${tableState.wcu}`,
      );
      return;
    }

    if (!tableState.rcu || !tableState.wcu) {
      task.skip(
        `Skipped, RCU = ${tableState.rcu} WCU = ${tableState.wcu} are not configured correctly`,
      );
      return;
    }

    task.output = `Configuring ${tableState.rcu} WCU = ${tableState.wcu} ...`;
    await this.ddbClient
      .updateTable({
        TableName: tableState.name,
        ProvisionedThroughput: {
          ReadCapacityUnits: tableState.rcu,
          WriteCapacityUnits: tableState.wcu,
        },
      })
      .promise();

    task.output = `Configured RCU = ${tableState.rcu} WCU = ${tableState.wcu}`;
  }
}
