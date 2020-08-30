import AWS from 'aws-sdk';
import AWSMock from 'aws-sdk-mock';

import { ListrTaskWrapper } from 'listr';

import {
  DecreaseKinesisStreamsShardsTrick,
  DecreaseKinesisStreamsShardsState,
} from '../../src/tricks/decrease-kinesis-streams-shards.trick';

beforeAll(async done => {
  // AWSMock cannot mock waiters at the moment
  AWS.Kinesis.prototype.waitFor = jest.fn().mockImplementation(() => ({
    promise: jest.fn(),
  }));

  done();
});

describe('decrease-kinesis-streams-shards', () => {
  let task: ListrTaskWrapper;

  beforeEach(() => {
    task = {
      title: '',
      output: '',
      run: jest.fn(),
      skip: jest.fn(),
      report: jest.fn(),
    };
  });

  it('returns correct machine name', async () => {
    const instance = new DecreaseKinesisStreamsShardsTrick();
    expect(instance.getMachineName()).toBe(
      DecreaseKinesisStreamsShardsTrick.machineName,
    );
  });

  it('returns different title for conserve and restore commands', async () => {
    const instance = new DecreaseKinesisStreamsShardsTrick();
    expect(instance.getConserveTitle()).not.toBe(instance.getRestoreTitle());
  });

  it('returns an empty Listr if no streams found', async () => {
    AWSMock.setSDKInstance(AWS);

    AWSMock.mock(
      'Kinesis',
      'listStreams',
      (params: AWS.Kinesis.Types.ListStreamsInput, callback: Function) => {
        callback(null, {
          HasMoreStreams: false,
          StreamNames: [],
        } as AWS.Kinesis.Types.ListStreamsOutput);
      },
    );

    const instance = new DecreaseKinesisStreamsShardsTrick();
    const stateObject: DecreaseKinesisStreamsShardsState = [];
    const listr = await instance.getCurrentState(task, stateObject, {
      dryRun: false,
    });

    expect(listr.tasks.length).toBe(0);

    AWSMock.restore('Kinesis');
  });

  it('generates state object for Kinesis streams', async () => {
    AWSMock.setSDKInstance(AWS);

    AWSMock.mock(
      'Kinesis',
      'listStreams',
      (params: AWS.Kinesis.Types.ListStreamsInput, callback: Function) => {
        callback(null, {
          HasMoreStreams: false,
          StreamNames: ['foo'],
        } as AWS.Kinesis.Types.ListStreamsOutput);
      },
    );

    AWSMock.mock(
      'Kinesis',
      'describeStreamSummary',
      (
        params: AWS.Kinesis.Types.DescribeStreamSummaryInput,
        callback: Function,
      ) => {
        callback(null, {
          StreamDescriptionSummary: {
            OpenShardCount: 4,
            StreamStatus: 'ACTIVE',
          },
        } as AWS.Kinesis.Types.DescribeStreamSummaryOutput);
      },
    );

    const instance = new DecreaseKinesisStreamsShardsTrick();
    const stateObject: DecreaseKinesisStreamsShardsState = [];
    const listr = await instance.getCurrentState(task, stateObject, {
      dryRun: false,
    });

    listr.setRenderer('silent');
    await listr.run({});

    expect(stateObject).toMatchObject([
      {
        name: 'foo',
        shards: 4,
        state: 'ACTIVE',
      },
    ] as DecreaseKinesisStreamsShardsState);

    AWSMock.restore('Kinesis');
  });

  it('conserves active Kinesis stream with 4 open shards', async () => {
    AWSMock.setSDKInstance(AWS);

    const updateShardCountSpy = jest
      .fn()
      .mockImplementation((params, callback) => {
        callback(null, {});
      });
    AWSMock.mock('Kinesis', 'updateShardCount', updateShardCountSpy);

    const instance = new DecreaseKinesisStreamsShardsTrick();
    const stateObject: DecreaseKinesisStreamsShardsState = [
      {
        name: 'foo',
        state: 'ACTIVE',
        shards: 4,
      },
    ];
    const conserveListr = await instance.conserve(task, stateObject, {
      dryRun: false,
    });
    conserveListr.setRenderer('silent');
    await conserveListr.run({});

    expect(updateShardCountSpy).toBeCalledTimes(2);

    expect(updateShardCountSpy).toBeCalledWith(
      expect.objectContaining({
        StreamName: 'foo',
        TargetShardCount: 2,
        ScalingType: 'UNIFORM_SCALING',
      }),
      expect.anything(),
    );

    expect(updateShardCountSpy).toBeCalledWith(
      expect.objectContaining({
        StreamName: 'foo',
        TargetShardCount: 1,
        ScalingType: 'UNIFORM_SCALING',
      }),
      expect.anything(),
    );

    AWSMock.restore('Kinesis');
  });

  it('conserves active Kinesis stream with 13 open shards', async () => {
    AWSMock.setSDKInstance(AWS);

    const updateShardCountSpy = jest
      .fn()
      .mockImplementation((params, callback) => {
        callback(null, {});
      });
    AWSMock.mock('Kinesis', 'updateShardCount', updateShardCountSpy);

    const instance = new DecreaseKinesisStreamsShardsTrick();
    const stateObject: DecreaseKinesisStreamsShardsState = [
      {
        name: 'foo',
        state: 'ACTIVE',
        shards: 13,
      },
    ];
    const conserveListr = await instance.conserve(task, stateObject, {
      dryRun: false,
    });
    conserveListr.setRenderer('silent');
    await conserveListr.run({});

    expect(updateShardCountSpy).toBeCalledWith(
      expect.objectContaining({
        StreamName: 'foo',
        TargetShardCount: 7,
        ScalingType: 'UNIFORM_SCALING',
      }),
      expect.anything(),
    );

    expect(updateShardCountSpy).toBeCalledWith(
      expect.objectContaining({
        StreamName: 'foo',
        TargetShardCount: 4,
        ScalingType: 'UNIFORM_SCALING',
      }),
      expect.anything(),
    );

    expect(updateShardCountSpy).toBeCalledWith(
      expect.objectContaining({
        StreamName: 'foo',
        TargetShardCount: 2,
        ScalingType: 'UNIFORM_SCALING',
      }),
      expect.anything(),
    );

    expect(updateShardCountSpy).toBeCalledWith(
      expect.objectContaining({
        StreamName: 'foo',
        TargetShardCount: 1,
        ScalingType: 'UNIFORM_SCALING',
      }),
      expect.anything(),
    );

    expect(updateShardCountSpy).toBeCalledTimes(4);

    AWSMock.restore('Kinesis');
  });

  it('skips conserve for non-active Kinesis streams', async () => {
    AWSMock.setSDKInstance(AWS);

    const updateShardCountSpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback(null, {});
      });
    AWSMock.mock('Kinesis', 'updateShardCount', updateShardCountSpy);

    const instance = new DecreaseKinesisStreamsShardsTrick();
    const stateObject: DecreaseKinesisStreamsShardsState = [
      {
        name: 'foo',
        state: 'CREATING',
        shards: 6,
      },
      {
        name: 'bar',
        state: 'UPDATING',
        shards: 4,
      },
    ];
    const conserveListr = await instance.conserve(task, stateObject, {
      dryRun: false,
    });
    conserveListr.setRenderer('silent');
    await conserveListr.run({});

    expect(updateShardCountSpy).not.toBeCalled();

    AWSMock.restore('Kinesis');
  });

  it('skips conserve for active stream if open shards already is 1', async () => {
    AWSMock.setSDKInstance(AWS);

    const updateShardCountSpy = jest.fn();
    AWSMock.mock('Kinesis', 'updateShardCount', updateShardCountSpy);

    const instance = new DecreaseKinesisStreamsShardsTrick();
    const stateObject: DecreaseKinesisStreamsShardsState = [
      {
        name: 'foo',
        state: 'ACTIVE',
        shards: 1,
      },
    ];
    const conserveListr = await instance.conserve(task, stateObject, {
      dryRun: false,
    });
    conserveListr.setRenderer('silent');
    await conserveListr.run({});

    expect(updateShardCountSpy).not.toBeCalled();

    AWSMock.restore('Kinesis');
  });

  it('skips conserve if no Kinesis streams are found', async () => {
    AWSMock.setSDKInstance(AWS);

    const instance = new DecreaseKinesisStreamsShardsTrick();
    const stateObject: DecreaseKinesisStreamsShardsState = [];

    const updateShardCountSpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback(null, {});
      });
    AWSMock.mock('Kinesis', 'updateShardCount', updateShardCountSpy);

    await instance.conserve(task, stateObject, {
      dryRun: false,
    });

    expect(updateShardCountSpy).not.toBeCalled();
    expect(task.skip).toBeCalledWith(expect.any(String));

    AWSMock.restore('Kinesis');
  });

  it('skips conserve if dry-run option is enabled', async () => {
    AWSMock.setSDKInstance(AWS);

    const updateShardCountSpy = jest.fn();
    AWSMock.mock('Kinesis', 'updateShardCount', updateShardCountSpy);

    const instance = new DecreaseKinesisStreamsShardsTrick();
    const stateObject: DecreaseKinesisStreamsShardsState = [
      {
        name: 'foo',
        state: 'ACTIVE',
        shards: 4,
      },
    ];

    const conserveListr = await instance.conserve(task, stateObject, {
      dryRun: true,
    });
    conserveListr.setRenderer('silent');
    await conserveListr.run({});

    expect(updateShardCountSpy).not.toBeCalled();

    AWSMock.restore('Kinesis');
  });

  it('restores scaled down Kinesis stream with actual 1 open shards', async () => {
    AWSMock.setSDKInstance(AWS);

    AWSMock.mock(
      'Kinesis',
      'describeStreamSummary',
      (
        params: AWS.Kinesis.Types.DescribeStreamSummaryInput,
        callback: Function,
      ) => {
        callback(null, {
          StreamDescriptionSummary: {
            OpenShardCount: 1,
            StreamStatus: 'ACTIVE',
          },
        } as AWS.Kinesis.Types.DescribeStreamSummaryOutput);
      },
    );

    const updateShardCountSpy = jest
      .fn()
      .mockImplementation((params, callback) => {
        callback(null, {});
      });
    AWSMock.mock('Kinesis', 'updateShardCount', updateShardCountSpy);

    const instance = new DecreaseKinesisStreamsShardsTrick();
    const stateObject: DecreaseKinesisStreamsShardsState = [
      {
        name: 'foo',
        state: 'ACTIVE',
        shards: 5,
      },
    ];
    const restoreListr = await instance.restore(task, stateObject, {
      dryRun: false,
    });
    restoreListr.setRenderer('silent');
    await restoreListr.run({});

    expect(updateShardCountSpy).toBeCalledTimes(3);

    expect(updateShardCountSpy).toBeCalledWith(
      expect.objectContaining({
        StreamName: 'foo',
        TargetShardCount: 2,
        ScalingType: 'UNIFORM_SCALING',
      }),
      expect.anything(),
    );

    expect(updateShardCountSpy).toBeCalledWith(
      expect.objectContaining({
        StreamName: 'foo',
        TargetShardCount: 4,
        ScalingType: 'UNIFORM_SCALING',
      }),
      expect.anything(),
    );

    expect(updateShardCountSpy).toBeCalledWith(
      expect.objectContaining({
        StreamName: 'foo',
        TargetShardCount: 5,
        ScalingType: 'UNIFORM_SCALING',
      }),
      expect.anything(),
    );

    AWSMock.restore('Kinesis');
  });

  it('restores scaled down Kinesis stream with actual 2 open shards', async () => {
    AWSMock.setSDKInstance(AWS);

    AWSMock.mock(
      'Kinesis',
      'describeStreamSummary',
      (
        params: AWS.Kinesis.Types.DescribeStreamSummaryInput,
        callback: Function,
      ) => {
        callback(null, {
          StreamDescriptionSummary: {
            OpenShardCount: 2,
            StreamStatus: 'ACTIVE',
          },
        } as AWS.Kinesis.Types.DescribeStreamSummaryOutput);
      },
    );

    const updateShardCountSpy = jest
      .fn()
      .mockImplementation((params, callback) => {
        callback(null, {});
      });
    AWSMock.mock('Kinesis', 'updateShardCount', updateShardCountSpy);

    const instance = new DecreaseKinesisStreamsShardsTrick();
    const stateObject: DecreaseKinesisStreamsShardsState = [
      {
        name: 'foo',
        state: 'ACTIVE',
        shards: 7,
      },
    ];
    const restoreListr = await instance.restore(task, stateObject, {
      dryRun: false,
    });
    restoreListr.setRenderer('silent');
    await restoreListr.run({});

    expect(updateShardCountSpy).toBeCalledTimes(2);

    expect(updateShardCountSpy).toBeCalledWith(
      expect.objectContaining({
        StreamName: 'foo',
        TargetShardCount: 4,
        ScalingType: 'UNIFORM_SCALING',
      }),
      expect.anything(),
    );

    expect(updateShardCountSpy).toBeCalledWith(
      expect.objectContaining({
        StreamName: 'foo',
        TargetShardCount: 7,
        ScalingType: 'UNIFORM_SCALING',
      }),
      expect.anything(),
    );

    AWSMock.restore('Kinesis');
  });

  it('skips restore if no streams were conserved', async () => {
    const instance = new DecreaseKinesisStreamsShardsTrick();
    const stateObject: DecreaseKinesisStreamsShardsState = [];

    const updateShardCountSpy = jest
      .fn()
      .mockImplementation((params, callback) => {
        callback(null, {});
      });
    AWSMock.mock('Kinesis', 'updateShardCount', updateShardCountSpy);

    await instance.restore(task, stateObject, {
      dryRun: false,
    });

    expect(updateShardCountSpy).not.toBeCalled();
    expect(task.skip).toBeCalledWith(expect.any(String));
  });

  it('skips restore if original status was not "ACTIVE"', async () => {
    AWSMock.setSDKInstance(AWS);

    const updateShardCountSpy = jest.fn();
    AWSMock.mock('Kinesis', 'updateShardCount', updateShardCountSpy);

    const instance = new DecreaseKinesisStreamsShardsTrick();
    const stateObject: DecreaseKinesisStreamsShardsState = [
      {
        name: 'foo',
        state: 'UPDATING',
        shards: 3,
      },
    ];

    const restoreListr = await instance.restore(task, stateObject, {
      dryRun: false,
    });
    restoreListr.setRenderer('silent');
    await restoreListr.run({});

    expect(updateShardCountSpy).not.toBeCalled();

    AWSMock.restore('Kinesis');
  });

  it('skips restore if original shards was already 1', async () => {
    AWSMock.setSDKInstance(AWS);

    const updateShardCountSpy = jest.fn();
    AWSMock.mock('Kinesis', 'updateShardCount', updateShardCountSpy);

    const instance = new DecreaseKinesisStreamsShardsTrick();
    const stateObject: DecreaseKinesisStreamsShardsState = [
      {
        name: 'foo',
        state: 'ACTIVE',
        shards: 1,
      },
    ];

    const restoreListr = await instance.restore(task, stateObject, {
      dryRun: false,
    });
    restoreListr.setRenderer('silent');
    await restoreListr.run({});

    expect(updateShardCountSpy).not.toBeCalled();

    AWSMock.restore('Kinesis');
  });

  it('skips restore if original shards is not defined in state', async () => {
    AWSMock.setSDKInstance(AWS);

    const updateShardCountSpy = jest.fn();
    AWSMock.mock('Kinesis', 'updateShardCount', updateShardCountSpy);

    const instance = new DecreaseKinesisStreamsShardsTrick();
    const stateObject = [
      {
        name: 'foo',
        state: 'ACTIVE',
        // shards: xx,
      },
    ] as DecreaseKinesisStreamsShardsState;

    const restoreListr = await instance.restore(task, stateObject, {
      dryRun: false,
    });
    restoreListr.setRenderer('silent');
    await restoreListr.run({});

    expect(updateShardCountSpy).not.toBeCalled();

    AWSMock.restore('Kinesis');
  });

  it('skips restore if actual open shards are greater than original shards', async () => {
    AWSMock.setSDKInstance(AWS);

    AWSMock.mock(
      'Kinesis',
      'describeStreamSummary',
      (
        params: AWS.Kinesis.Types.DescribeStreamSummaryInput,
        callback: Function,
      ) => {
        callback(null, {
          StreamDescriptionSummary: {
            OpenShardCount: 10,
            StreamStatus: 'ACTIVE',
          },
        } as AWS.Kinesis.Types.DescribeStreamSummaryOutput);
      },
    );

    const updateShardCountSpy = jest.fn();
    AWSMock.mock('Kinesis', 'updateShardCount', updateShardCountSpy);

    const instance = new DecreaseKinesisStreamsShardsTrick();
    const stateObject: DecreaseKinesisStreamsShardsState = [
      {
        name: 'foo',
        state: 'ACTIVE',
        shards: 7,
      },
    ];
    const restoreListr = await instance.restore(task, stateObject, {
      dryRun: false,
    });
    restoreListr.setRenderer('silent');
    await restoreListr.run({});

    expect(updateShardCountSpy).not.toBeCalled();

    AWSMock.restore('Kinesis');
  });

  it('skips restore for stream if dry-run option is enabled', async () => {
    AWSMock.setSDKInstance(AWS);

    const updateShardCountSpy = jest.fn();
    AWSMock.mock('Kinesis', 'updateShardCount', updateShardCountSpy);

    const instance = new DecreaseKinesisStreamsShardsTrick();
    const stateObject: DecreaseKinesisStreamsShardsState = [
      {
        name: 'foo',
        state: 'ACTIVE',
        shards: 3,
      },
    ];

    const restoreListr = await instance.restore(task, stateObject, {
      dryRun: true,
    });
    restoreListr.setRenderer('silent');
    await restoreListr.run({});

    expect(updateShardCountSpy).not.toBeCalled();

    AWSMock.restore('Kinesis');
  });
});
