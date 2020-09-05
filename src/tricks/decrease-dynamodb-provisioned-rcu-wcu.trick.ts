import AWS from 'aws-sdk';
import chalk from 'chalk';
import { Listr, ListrTask, ListrTaskWrapper } from 'listr2';

import { TrickInterface } from '../interfaces/trick.interface';
import { TrickOptionsInterface } from '../interfaces/trick-options.interface';

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

  async getCurrentState(
    task: ListrTaskWrapper<any, any>,
    currentState: DecreaseDynamoDBProvisionedRcuWcuState,
    options: TrickOptionsInterface,
  ): Promise<Listr> {
    const tableNames = await this.listTableNames(task);

    const subListr = task.newListr([], {
      concurrent: 10,
      exitOnError: false,
      rendererOptions: {
        collapse: true,
      },
    });

    if (!tableNames || tableNames.length === 0) {
      task.skip(chalk.dim('no DynamoDB tables found'));
      return subListr;
    }

    subListr.add(
      tableNames.map(
        (tableName): ListrTask => {
          const tableState = {
            name: tableName,
          } as DynamoDBTableState;
          currentState.push(tableState);
          return {
            title: tableName,
            task: async (ctx, task) => this.getTableState(task, tableState),
            options: {
              persistentOutput: true,
            },
          };
        },
      ),
    );

    return subListr;
  }

  async conserve(
    task: ListrTaskWrapper<any, any>,
    currentState: DecreaseDynamoDBProvisionedRcuWcuState,
    options: TrickOptionsInterface,
  ): Promise<Listr> {
    const subListr = task.newListr([], {
      concurrent: 10,
      exitOnError: false,
      rendererOptions: { collapse: true },
    });

    if (currentState && currentState.length > 0) {
      for (const table of currentState) {
        subListr.add({
          title: `${chalk.greenBright(table.name)}`,
          task: (ctx, task) =>
            this.conserveTableProvisionedRcuWcu(task, table, options),
          options: {
            persistentOutput: true,
          },
        });
      }
    } else {
      task.skip(chalk.dim(`no DynamoDB tables found`));
    }

    return subListr;
  }

  async restore(
    task: ListrTaskWrapper<any, any>,
    currentState: DecreaseDynamoDBProvisionedRcuWcuState,
    options: TrickOptionsInterface,
  ): Promise<Listr> {
    const subListr = task.newListr([], {
      concurrent: 10,
      exitOnError: false,
      rendererOptions: { collapse: true },
    });

    if (currentState && currentState.length > 0) {
      for (const table of currentState) {
        subListr.add({
          title: `${chalk.greenBright(table.name)}`,
          task: (ctx, task) =>
            this.restoreTableProvisionedRcuWcu(task, table, options),
          options: {
            persistentOutput: true,
          },
        });
      }
    } else {
      task.skip(chalk.dim(`no DynamoDB tables was conserved`));
    }

    return subListr;
  }

  private async listTableNames(
    task: ListrTaskWrapper<any, any>,
  ): Promise<AWS.DynamoDB.TableNameList> {
    const tableNames: string[] = [];

    // TODO Add logic to go through all pages
    task.output = 'fetching page 1...';
    tableNames.push(
      ...((await this.ddbClient.listTables({ Limit: 100 }).promise())
        .TableNames || []),
    );

    return tableNames;
  }

  private async getTableState(
    task: ListrTaskWrapper<any, any>,
    tableState: DynamoDBTableState,
  ): Promise<void> {
    task.output = 'fetching table information...';
    const provisionedThroughput = ((
      await this.ddbClient
        .describeTable({ TableName: tableState.name })
        .promise()
    ).Table as AWS.DynamoDB.TableDescription).ProvisionedThroughput;

    if (!provisionedThroughput) {
      tableState.provisionedThroughput = false;
      return;
    }

    tableState.provisionedThroughput = true;
    tableState.rcu = provisionedThroughput.ReadCapacityUnits as number;
    tableState.wcu = provisionedThroughput.WriteCapacityUnits as number;

    task.output = 'done';
  }

  private async conserveTableProvisionedRcuWcu(
    task: ListrTaskWrapper<any, any>,
    tableState: DynamoDBTableState,
    options: TrickOptionsInterface,
  ): Promise<void> {
    if (!tableState.provisionedThroughput) {
      task.skip(chalk.dim(`provisioned throughput is not configured`));
      return;
    }

    if (tableState.wcu < 2 && tableState.rcu < 2) {
      task.skip(chalk.dim(`provisioned RCU/WCU is already at minimum of 1`));
      return;
    }

    if (options.dryRun) {
      task.skip(chalk.dim('skipped, would configure RCU = 1 WCU = 1'));
      return;
    }

    task.output = `configuring RCU = 1 WCU = 1 ...`;
    await this.ddbClient
      .updateTable({
        TableName: tableState.name,
        ProvisionedThroughput: {
          ReadCapacityUnits: 1,
          WriteCapacityUnits: 1,
        },
      })
      .promise();

    task.output = `configured RCU = 1 WCU = 1`;
  }

  private async restoreTableProvisionedRcuWcu(
    task: ListrTaskWrapper<any, any>,
    tableState: DynamoDBTableState,
    options: TrickOptionsInterface,
  ): Promise<void> {
    if (!tableState.provisionedThroughput) {
      task.skip(chalk.dim(`provisioned throughput was not configured`));
      return;
    }

    if (options.dryRun) {
      task.skip(
        chalk.dim(
          `skipped, would configure RCU = ${tableState.rcu} WCU = ${tableState.wcu}`,
        ),
      );
      return;
    }

    if (!tableState.rcu || !tableState.wcu) {
      task.skip(
        chalk.dim(
          `skipped, RCU = ${tableState.rcu} WCU = ${tableState.wcu} are not configured correctly`,
        ),
      );
      return;
    }

    task.output = `configuring ${tableState.rcu} WCU = ${tableState.wcu} ...`;
    await this.ddbClient
      .updateTable({
        TableName: tableState.name,
        ProvisionedThroughput: {
          ReadCapacityUnits: tableState.rcu,
          WriteCapacityUnits: tableState.wcu,
        },
      })
      .promise();

    task.output = `configured RCU = ${tableState.rcu} WCU = ${tableState.wcu}`;
  }
}
