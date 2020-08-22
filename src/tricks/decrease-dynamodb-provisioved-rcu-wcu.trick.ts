import AWS from 'aws-sdk';
import Listr, { ListrTaskWrapper } from 'listr';
import chalk from 'chalk';

import { TrickInterface } from '../interfaces/trick.interface';
import { DynamoDBTableState } from '../states/dynamodb-table.state';

export type DecreaseDynamoDBProvisionedRcuWcuState = DynamoDBTableState[];

export class DecreaseDynamoDBProvisionedRcuWcuTrick
  implements TrickInterface<DecreaseDynamoDBProvisionedRcuWcuState> {
  private ddbClient: AWS.DynamoDB;

  constructor() {
    this.ddbClient = new AWS.DynamoDB();
  }

  getMachineName(): string {
    return 'decrease-dynamodb-provisioned-rcu-wcu';
  }

  getDisplayName(): string {
    return 'Decrease DynamoDB Provisioned RCU and WCU';
  }

  async conserve(
    subListr: Listr,
    dryRun: boolean,
  ): Promise<DecreaseDynamoDBProvisionedRcuWcuState> {
    const tables = await this.listTables();
    const currentState = await this.getCurrentState(tables);

    for (const table of currentState) {
      subListr.add({
        title: chalk.blueBright(`${table.name}`),
        task: (ctx, task) => this.conserveTable(task, dryRun, table),
      });
    }

    return currentState;
  }

  async restore(
    subListr: Listr,
    dryRun: boolean,
    originalState: DecreaseDynamoDBProvisionedRcuWcuState,
  ): Promise<void> {
    for (const table of originalState) {
      subListr.add({
        title: chalk.blueBright(table.name),
        task: (ctx, task) => this.restoreTable(task, dryRun, table),
      });
    }
  }

  private async conserveTable(
    task: ListrTaskWrapper,
    dryRun: boolean,
    tableState: DynamoDBTableState,
  ): Promise<void> {
    if (dryRun) {
      task.skip('Skipped due to dry-run');
    } else if (tableState.provisionedThroughput) {
      if (tableState.wcu > 1 && tableState.rcu > 1) {
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
      } else {
        task.skip(`Provisioned RCU/WCU is already at minimum of 1`);
      }
    } else {
      task.skip(`Provisioned throughput is not configured`);
    }
  }

  private async restoreTable(
    task: ListrTaskWrapper,
    dryRun: boolean,
    tableState: DynamoDBTableState,
  ): Promise<void> {
    if (dryRun) {
      task.skip(`Skipped due to dry-run`);
    } else if (tableState.provisionedThroughput) {
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
    } else {
      task.skip(`Provisioned throughput was not configured`);
    }
  }

  private async getCurrentState(
    tables: AWS.DynamoDB.TableNameList,
  ): Promise<DynamoDBTableState[]> {
    return Promise.all(
      tables.map(
        async (table): Promise<DynamoDBTableState> => {
          const provisionedThroughput = (
            await this.ddbClient.describeTable({ TableName: table }).promise()
          ).Table?.ProvisionedThroughput;

          if (!provisionedThroughput) {
            return {
              name: table,
              provisionedThroughput: false,
              rcu: 0,
              wcu: 0,
            };
          }

          return {
            name: table,
            provisionedThroughput: true,
            rcu: provisionedThroughput.ReadCapacityUnits || 0,
            wcu: provisionedThroughput.ReadCapacityUnits || 0,
          };
        },
      ),
    );
  }

  private async listTables(): Promise<AWS.DynamoDB.TableNameList> {
    return (await this.ddbClient.listTables().promise()).TableNames || [];
  }
}
