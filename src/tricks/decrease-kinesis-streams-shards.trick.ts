import AWS from 'aws-sdk';
import chalk from 'chalk';
import { Listr, ListrTask, ListrTaskWrapper } from 'listr2';

import { TrickInterface } from '../interfaces/trick.interface';
import { TrickOptionsInterface } from '../interfaces/trick-options.interface';

import { KinesisStreamState } from '../states/kinesis-stream.state';

export type DecreaseKinesisStreamsShardsState = KinesisStreamState[];

export class DecreaseKinesisStreamsShardsTrick
  implements TrickInterface<DecreaseKinesisStreamsShardsState> {
  private ksClient: AWS.Kinesis;

  static machineName = 'decrease-kinesis-streams-shards';

  constructor() {
    this.ksClient = new AWS.Kinesis();
  }

  getMachineName(): string {
    return DecreaseKinesisStreamsShardsTrick.machineName;
  }

  async getCurrentState(
    task: ListrTaskWrapper<any, any>,
    currentState: DecreaseKinesisStreamsShardsState,
    options: TrickOptionsInterface,
  ): Promise<Listr> {
    const streamNames = await this.listKinesisStreamsNames(task);

    const subListr = task.newListr([], {
      concurrent: 10,
      exitOnError: false,
      rendererOptions: {
        collapse: true,
      },
    });

    if (!streamNames || streamNames.length === 0) {
      task.skip(chalk.dim('no Kinesis Streams found'));
      return subListr;
    }

    subListr.add(
      streamNames.map(
        (streamName): ListrTask => {
          const streamState = {
            name: streamName,
          } as KinesisStreamState;
          currentState.push(streamState);
          return {
            title: streamName,
            task: async (ctx, task) => this.getStreamState(task, streamState),
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
    currentState: DecreaseKinesisStreamsShardsState,
    options: TrickOptionsInterface,
  ): Promise<Listr> {
    const subListr = task.newListr([], {
      concurrent: 3,
      exitOnError: false,
      rendererOptions: { collapse: true },
    });

    if (currentState && currentState.length > 0) {
      for (const stream of currentState) {
        subListr.add({
          title: `${chalk.greenBright(stream.name)}`,
          task: (ctx, task) => this.conserveStreamShards(task, stream, options),
          options: {
            persistentOutput: true,
          },
        });
      }
    } else {
      task.skip(chalk.dim(`no Kinesis Stream found`));
    }

    return subListr;
  }

  async restore(
    task: ListrTaskWrapper<any, any>,
    originalState: DecreaseKinesisStreamsShardsState,
    options: TrickOptionsInterface,
  ): Promise<Listr> {
    const subListr = task.newListr([], {
      concurrent: 3,
      exitOnError: false,
      rendererOptions: { collapse: true },
    });

    if (originalState && originalState.length > 0) {
      for (const table of originalState) {
        subListr.add({
          title: chalk.greenBright(table.name),
          task: (ctx, task) => this.restoreStreamShards(task, table, options),
          options: {
            persistentOutput: true,
          },
        });
      }
    } else {
      task.skip(chalk.dim(`no Kinesis Stream was previously conserved`));
    }

    return subListr;
  }

  private async listKinesisStreamsNames(
    task: ListrTaskWrapper<any, any>,
  ): Promise<string[]> {
    const streamNames: string[] = [];

    // TODO Add logic to go through all pages
    task.output = 'fetching page 1...';
    streamNames.push(
      ...(await this.ksClient.listStreams({ Limit: 100 }).promise())
        .StreamNames,
    );

    return streamNames;
  }

  private async getStreamState(
    task: ListrTaskWrapper<any, any>,
    streamState: KinesisStreamState,
  ): Promise<void> {
    task.output = 'fetching stream information...';
    const summary = await this.getStreamSummary(streamState.name);

    streamState.shards = summary.OpenShardCount;
    streamState.state = summary.StreamStatus;

    task.output = 'done';
  }

  private async conserveStreamShards(
    task: ListrTaskWrapper<any, any>,
    streamState: KinesisStreamState,
    options: TrickOptionsInterface,
  ): Promise<void> {
    if (streamState.state !== 'ACTIVE') {
      task.skip(
        chalk.dim(`State is not Active, it is ${streamState.state} instead.`),
      );
      return;
    }

    if (streamState.shards < 2) {
      task.skip(chalk.dim(`Shards are already at minimum of 1`));
      return;
    }

    if (options.dryRun) {
      task.skip(chalk.dim(`skipped, would decrease number of shards to 1`));
      return;
    }

    let targetShards = streamState.shards;
    let step = 0;
    do {
      targetShards = Math.ceil(targetShards / 2);
      step += 1;
      task.output = `Step #${step}: decreasing shards to ${targetShards}, final target: 1...`;
      await this.ksClient
        .updateShardCount({
          StreamName: streamState.name,
          TargetShardCount: targetShards,
          ScalingType: 'UNIFORM_SCALING',
        })
        .promise();
      await this.ksClient
        .waitFor('streamExists', {
          StreamName: streamState.name,
          $waiter: {
            delay: 15,
            maxAttempts: 100,
          },
        })
        .promise();
    } while (targetShards > 1);

    task.output = `Decreased number of shards to ${targetShards}`;
  }

  private async restoreStreamShards(
    task: ListrTaskWrapper<any, any>,
    streamState: KinesisStreamState,
    options: TrickOptionsInterface,
  ): Promise<void> {
    if (streamState.state !== 'ACTIVE') {
      task.skip(
        chalk.dim(`State was not Active, it was ${streamState.state} instead.`),
      );
      return;
    }

    if (streamState.shards < 2) {
      task.skip(chalk.dim(`Shards were already at minimum of 1`));
      return;
    }

    if (!streamState.shards) {
      task.skip(chalk.dim(`Original number of shards is not found in state`));
      return;
    }

    if (options.dryRun) {
      task.skip(
        chalk.dim(
          `skipped, would increase number of shards to ${streamState.shards}`,
        ),
      );
      return;
    }

    const streamSummary = await this.getStreamSummary(streamState.name);
    const currentShards = streamSummary.OpenShardCount;

    if (currentShards >= streamState.shards) {
      task.skip(
        chalk.dim(
          `Stream shards are already configured to ${currentShards}. Previous number of shards: ${streamState.shards}`,
        ),
      );
      return;
    }

    let targetShards = currentShards;
    let step = 0;
    do {
      targetShards = Math.min(Math.floor(targetShards * 2), streamState.shards);
      step += 1;

      task.output = `Step #${step}: increasing shards to ${targetShards}, final target: ${streamState.shards}...`;
      await this.ksClient
        .updateShardCount({
          StreamName: streamState.name,
          TargetShardCount: targetShards,
          ScalingType: 'UNIFORM_SCALING',
        })
        .promise();
      await this.ksClient
        .waitFor('streamExists', {
          StreamName: streamState.name,
          $waiter: {
            delay: 15,
            maxAttempts: 100,
          },
        })
        .promise();
    } while (targetShards < streamState.shards);
  }

  private async getStreamSummary(
    streamName: string,
  ): Promise<AWS.Kinesis.StreamDescriptionSummary> {
    return (
      await this.ksClient
        .describeStreamSummary({
          StreamName: streamName,
        })
        .promise()
    ).StreamDescriptionSummary;
  }
}
