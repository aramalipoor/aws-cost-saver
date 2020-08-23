import AWS from 'aws-sdk';
import Listr, { ListrTaskWrapper } from 'listr';
import chalk from 'chalk';

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

  getDisplayName(): string {
    return 'Decrease Kinesis Streams Shards';
  }

  canBeConcurrent(): boolean {
    return true;
  }

  async conserve(
    subListr: Listr,
    dryRun: boolean,
  ): Promise<DecreaseKinesisStreamsShardsState> {
    const streamNames = await this.listKinesisStreamsNames();
    const currentState = await this.getCurrentState(streamNames);

    for (const stream of currentState) {
      subListr.add({
        title: chalk.blueBright(`${stream.name}`),
        task: (ctx, task) => this.conserveStreamShards(task, dryRun, stream),
      });
    }

    return currentState;
  }

  async restore(
    subListr: Listr,
    dryRun: boolean,
    originalState: DecreaseKinesisStreamsShardsState,
  ): Promise<void> {
    for (const table of originalState) {
      subListr.add({
        title: chalk.blueBright(table.name),
        task: (ctx, task) => this.restoreStreamShards(task, dryRun, table),
      });
    }
  }

  private async conserveStreamShards(
    task: ListrTaskWrapper,
    dryRun: boolean,
    streamState: KinesisStreamState,
  ): Promise<void> {
    if (dryRun) {
      task.skip('Skipped due to dry-run');
    } else if (streamState.state !== 'ACTIVE') {
      task.skip(`State is not Active, it is ${streamState.state} instead.`);
    } else if (streamState.shards > 1) {
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
              maxAttempts: 30,
            },
          })
          .promise();
      } while (targetShards > 1);
      task.output = `Decreased number of shards to ${targetShards}`;
    } else {
      task.skip(`Shards are already at minimum of 1`);
    }
  }

  private async restoreStreamShards(
    task: ListrTaskWrapper,
    dryRun: boolean,
    streamState: KinesisStreamState,
  ): Promise<void> {
    if (dryRun) {
      task.skip(`Skipped due to dry-run`);
    } else if (streamState.shards > 1) {
      const streamSummary = await this.getStreamSummary(streamState.name);
      const currentShards = streamSummary.OpenShardCount;

      if (currentShards >= streamState.shards) {
        task.skip(
          `Stream shards are already configured to ${currentShards}. Previous number of shards: ${streamState.shards}`,
        );
        return;
      }

      let targetShards = currentShards;
      let step = 0;
      do {
        targetShards = Math.min(
          Math.floor(targetShards * 2),
          streamState.shards,
        );
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
              maxAttempts: 30,
            },
          })
          .promise();
      } while (targetShards < streamState.shards);
    } else {
      task.skip(`Shards were already at minimum of 1`);
    }
  }

  private async getCurrentState(
    streamNames: string[],
  ): Promise<KinesisStreamState[]> {
    return Promise.all(
      streamNames.map(
        async (streamName): Promise<KinesisStreamState> => {
          const streamSummary = await this.getStreamSummary(streamName);
          return {
            name: streamName,
            state: streamSummary.StreamStatus,
            shards: streamSummary.OpenShardCount,
          };
        },
      ),
    );
  }

  private async listKinesisStreamsNames(): Promise<string[]> {
    return (await this.ksClient.listStreams().promise()).StreamNames || [];
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
