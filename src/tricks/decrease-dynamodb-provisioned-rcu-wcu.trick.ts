import AWS from 'aws-sdk';
import chalk from 'chalk';
import { Listr, ListrTask, ListrTaskWrapper } from 'listr2';
import { ResourceTagMappingList } from 'aws-sdk/clients/resourcegroupstaggingapi';

import { TrickInterface } from '../types/trick.interface';
import { TrickOptionsInterface } from '../types/trick-options.interface';

import { DynamoDBTableState } from '../states/dynamodb-table.state';
import { TrickContext } from '../types/trick-context';

export type DecreaseDynamoDBProvisionedRcuWcuState = DynamoDBTableState[];

export class DecreaseDynamoDBProvisionedRcuWcuTrick
  implements TrickInterface<DecreaseDynamoDBProvisionedRcuWcuState> {
  static machineName = 'decrease-dynamodb-provisioned-rcu-wcu';

  private ddbClient: AWS.DynamoDB;

  private rgtClient: AWS.ResourceGroupsTaggingAPI;

  constructor() {
    this.ddbClient = new AWS.DynamoDB();
    this.rgtClient = new AWS.ResourceGroupsTaggingAPI();
  }

  getMachineName(): string {
    return DecreaseDynamoDBProvisionedRcuWcuTrick.machineName;
  }

  async prepareTags(
    context: TrickContext,
    task: ListrTaskWrapper<any, any>,
    options: TrickOptionsInterface,
  ): Promise<void> {
    const resourceTagMappings: ResourceTagMappingList = [];

    // TODO Add logic to go through all pages
    task.output = 'fetching page 1...';
    resourceTagMappings.push(
      ...((
        await this.rgtClient
          .getResources({
            ResourcesPerPage: 100,
            ResourceTypeFilters: ['dynamodb:table'],
            TagFilters: options.tags,
          })
          .promise()
      ).ResourceTagMappingList as ResourceTagMappingList),
    );

    context.resourceTagMappings = resourceTagMappings;

    task.output = 'done';
  }

  async getCurrentState(
    context: TrickContext,
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

          if (!this.isTableIncluded(context, tableName)) {
            return {
              title: tableName,
              task: async (ctx, task) =>
                task.skip(`excluded due to tag filters`),
            };
          }

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
          title: `${chalk.blue(table.name)}`,
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
          title: `${chalk.blue(table.name)}`,
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
    const table = (
      await this.ddbClient
        .describeTable({ TableName: tableState.name })
        .promise()
    ).Table as AWS.DynamoDB.TableDescription;

    if (
      !table.ProvisionedThroughput ||
      (!table.ProvisionedThroughput.ReadCapacityUnits &&
        !table.ProvisionedThroughput.WriteCapacityUnits)
    ) {
      tableState.provisionedThroughput = false;
      return;
    }

    tableState.provisionedThroughput = true;
    tableState.rcu = table.ProvisionedThroughput.ReadCapacityUnits as number;
    tableState.wcu = table.ProvisionedThroughput.WriteCapacityUnits as number;

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

    const currentState = {
      name: tableState.name,
    } as DynamoDBTableState;
    await this.getTableState(task, currentState);

    if (
      currentState.rcu === tableState.rcu &&
      currentState.wcu === tableState.wcu
    ) {
      task.skip(
        chalk.dim(
          `skipped, RCU = ${tableState.rcu} WCU = ${tableState.wcu} are already configured`,
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

  private isTableIncluded(
    context: TrickContext,
    tableName: AWS.DynamoDB.TableName,
  ): boolean {
    return Boolean(
      context.resourceTagMappings?.find(
        rm => (rm.ResourceARN as string).split('/').pop() === tableName,
      ),
    );
  }
}
