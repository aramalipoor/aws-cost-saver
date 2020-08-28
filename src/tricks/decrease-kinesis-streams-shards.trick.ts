import AWS from 'aws-sdk';
import chalk from 'chalk';
import Listr, { ListrTask, ListrTaskWrapper } from 'listr';

import { TrickInterface } from '../interfaces/trick.interface';
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

  getConserveTitle(): string {
    return 'Decrease Kinesis Streams Shards';
  }

  getRestoreTitle(): string {
    return 'Restore Kinesis Streams Shards';
  }

  async getCurrentState(
    task: ListrTaskWrapper,
    currentState: DecreaseKinesisStreamsShardsState,
  ): Promise<Listr> {
    const streamNames = await this.listKinesisStreamsNames(task);

    if (!streamNames || streamNames.length === 0) {
      task.skip('No Kinesis Streams found');
      return;
    }

    const subListr = new Listr({
      concurrent: 10,
      exitOnError: false,
      // @ts-ignore
      collapse: false,
    });

    subListr.add(
      streamNames.map(
        (streamName): ListrTask => {
          const streamState: KinesisStreamState = {
            name: streamName,
          };
          currentState.push(streamState);
          return {
            title: streamName,
            task: async (ctx, task) => this.getStreamState(task, streamState),
          };
        },
      ),
    );

    return subListr;
  }

  async conserve(
    task: ListrTaskWrapper,
    currentState: DecreaseKinesisStreamsShardsState,
    dryRun: boolean,
  ): Promise<Listr> {
    const subListr = new Listr({
      concurrent: 5,
      exitOnError: false,
      // @ts-ignore
      collapse: false,
    });

    if (currentState && currentState.length > 0) {
      for (const stream of currentState) {
        subListr.add({
          title: `${chalk.blueBright(stream.name)}`,
          task: (ctx, task) => this.conserveStreamShards(task, stream, dryRun),
        });
      }
    } else {
      task.skip(`No Kinesis Stream found`);
    }

    return subListr;
  }

  async restore(
    task: ListrTaskWrapper,
    originalState: DecreaseKinesisStreamsShardsState,
    dryRun: boolean,
  ): Promise<Listr> {
    const subListr = new Listr({
      concurrent: 5,
      exitOnError: false,
      // @ts-ignore
      collapse: false,
    });

    if (originalState && originalState.length > 0) {
      for (const table of originalState) {
        subListr.add({
          title: chalk.blueBright(table.name),
          task: (ctx, task) => this.restoreStreamShards(task, table, dryRun),
        });
      }
    } else {
      task.skip(`No Kinesis Stream was previously conserved`);
    }

    return subListr;
  }

  private async listKinesisStreamsNames(
    task: ListrTaskWrapper,
  ): Promise<string[]> {
    const streamNames: string[] = [];

    // TODO Add logic to go through all pages
    task.output = 'Fetching page 1...';
    streamNames.push(
      ...((await this.ksClient.listStreams({ Limit: 100 }).promise())
        .StreamNames || []),
    );

    return streamNames;
  }

  private async getStreamState(
    task: ListrTaskWrapper,
    streamState: KinesisStreamState,
  ): Promise<void> {
    task.output = 'Fetching stream information...';
    const summary = await this.getStreamSummary(streamState.name);

    streamState.shards = summary.OpenShardCount;
    streamState.state = summary.StreamStatus;
  }

  private async conserveStreamShards(
    task: ListrTaskWrapper,
    streamState: KinesisStreamState,
    dryRun: boolean,
  ): Promise<void> {
    if (streamState.state !== 'ACTIVE') {
      task.skip(`State is not Active, it is ${streamState.state} instead.`);
      return;
    }

    if (streamState.shards < 2) {
      task.skip(`Shards are already at minimum of 1`);
      return;
    }

    if (dryRun) {
      task.skip(`Skipped, would decrease number of shards to 1`);
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
    task: ListrTaskWrapper,
    streamState: KinesisStreamState,
    dryRun: boolean,
  ): Promise<void> {
    if (streamState.shards < 2) {
      task.skip(`Shards were already at minimum of 1`);
      return;
    }

    const streamSummary = await this.getStreamSummary(streamState.name);
    const currentShards = streamSummary.OpenShardCount;

    if (currentShards >= streamState.shards) {
      task.skip(
        `Stream shards are already configured to ${currentShards}. Previous number of shards: ${streamState.shards}`,
      );
      return;
    }

    if (!streamState.shards) {
      task.skip(`Original number of shards is not found in state`);
      return;
    }

    if (dryRun) {
      task.skip(
        `Skipped, would increase number of shards to ${streamState.shards}`,
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
