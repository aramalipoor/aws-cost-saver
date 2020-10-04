import AWS from 'aws-sdk';
import AWSMock from 'aws-sdk-mock';
import { mockProcessStdout } from 'jest-mock-process';
import { ListrTaskWrapper } from 'listr2';
import nock from 'nock';

import {
  ShutdownEC2InstancesTrick,
  ShutdownEC2InstancesState,
} from '../../src/tricks/shutdown-ec2-instances.trick';
import { TrickContext } from '../../src/types/trick-context';
import { createMockTask } from '../util';

beforeAll(async done => {
  nock.abortPendingRequests();
  nock.cleanAll();
  nock.disableNetConnect();

  // AWSMock cannot mock waiters at the moment
  AWS.EC2.prototype.waitFor = jest.fn().mockImplementation(() => ({
    promise: jest.fn(),
  }));

  mockProcessStdout();
  done();
});

afterEach(async () => {
  const pending = nock.pendingMocks();

  if (pending.length > 0) {
    // eslint-disable-next-line no-console
    console.log(pending);
    throw new Error(`${pending.length} mocks are pending!`);
  }
});

describe('shutdown-ec2-instances', () => {
  let task: ListrTaskWrapper<any, any>;

  beforeEach(() => {
    task = createMockTask();
  });

  it('returns correct machine name', async () => {
    const instance = new ShutdownEC2InstancesTrick();
    expect(instance.getMachineName()).toBe(
      ShutdownEC2InstancesTrick.machineName,
    );
  });

  it('skips preparing tags', async () => {
    const instance = new ShutdownEC2InstancesTrick();
    await instance.prepareTags(task, {} as TrickContext, {
      dryRun: false,
    });
    expect(task.skip).toBeCalled();
  });

  it('returns an empty Listr if no instances found', async () => {
    AWSMock.setSDKInstance(AWS);

    AWSMock.mock(
      'EC2',
      'describeInstances',
      (params: AWS.EC2.Types.DescribeInstancesRequest, callback: Function) => {
        callback(null, {
          Reservations: [{ Instances: [] }],
        } as AWS.EC2.Types.DescribeInstancesResult);
      },
    );

    const instance = new ShutdownEC2InstancesTrick();
    const stateObject: ShutdownEC2InstancesState = [];
    const listr = await instance.getCurrentState(
      task,
      { resourceTagMappings: [] } as TrickContext,
      stateObject,
      {
        dryRun: false,
      },
    );

    expect(listr.tasks.length).toBe(0);

    AWSMock.restore('EC2');
  });

  it('returns an empty Listr if Reservations.Instances was not returned by AWS', async () => {
    AWSMock.setSDKInstance(AWS);

    AWSMock.mock(
      'EC2',
      'describeInstances',
      (params: AWS.EC2.Types.DescribeInstancesRequest, callback: Function) => {
        callback(null, {
          Reservations: [{ ReservationId: 'blah' }],
        } as AWS.EC2.Types.DescribeInstancesResult);
      },
    );

    const instance = new ShutdownEC2InstancesTrick();
    const stateObject: ShutdownEC2InstancesState = [];
    const listr = await instance.getCurrentState(
      task,
      { resourceTagMappings: [] } as TrickContext,
      stateObject,
      {
        dryRun: false,
      },
    );

    expect(listr.tasks.length).toBe(0);

    AWSMock.restore('EC2');
  });

  it('returns an empty Listr if Reservations was not returned by AWS', async () => {
    AWSMock.setSDKInstance(AWS);

    AWSMock.mock(
      'EC2',
      'describeInstances',
      (params: AWS.EC2.Types.DescribeInstancesRequest, callback: Function) => {
        callback(null, {} as AWS.EC2.Types.DescribeInstancesResult);
      },
    );

    const instance = new ShutdownEC2InstancesTrick();
    const stateObject: ShutdownEC2InstancesState = [];
    const listr = await instance.getCurrentState(
      task,
      { resourceTagMappings: [] } as TrickContext,
      stateObject,
      {
        dryRun: false,
      },
    );

    expect(listr.tasks.length).toBe(0);

    AWSMock.restore('EC2');
  });

  it('errors if InstanceId was not returned by AWS', async () => {
    AWSMock.setSDKInstance(AWS);

    AWSMock.mock(
      'EC2',
      'describeInstances',
      (params: AWS.EC2.Types.DescribeInstancesRequest, callback: Function) => {
        callback(null, {
          Reservations: [{ Instances: [{ State: { Name: 'running' } }] }],
        } as AWS.EC2.Types.DescribeInstancesResult);
      },
    );

    const instance = new ShutdownEC2InstancesTrick();
    const stateObject: ShutdownEC2InstancesState = [];
    const listr = await instance.getCurrentState(
      task,
      { resourceTagMappings: [] } as TrickContext,
      stateObject,
      {
        dryRun: false,
      },
    );

    await listr.run();

    expect(listr.err).toStrictEqual([
      expect.objectContaining({
        errors: [
          expect.objectContaining({
            message: expect.stringMatching(/unexpected/gi),
          }),
        ],
      }),
    ]);

    AWSMock.restore('EC2');
  });

  it('errors if State was not returned by AWS', async () => {
    AWSMock.setSDKInstance(AWS);

    AWSMock.mock(
      'EC2',
      'describeInstances',
      (params: AWS.EC2.Types.DescribeInstancesRequest, callback: Function) => {
        callback(null, {
          Reservations: [{ Instances: [{ InstanceId: 'foo' }] }],
        } as AWS.EC2.Types.DescribeInstancesResult);
      },
    );

    const instance = new ShutdownEC2InstancesTrick();
    const stateObject: ShutdownEC2InstancesState = [];
    const listr = await instance.getCurrentState(
      task,
      { resourceTagMappings: [] } as TrickContext,
      stateObject,
      {
        dryRun: false,
      },
    );

    await listr.run();

    expect(listr.err).toStrictEqual([
      expect.objectContaining({
        errors: [
          expect.objectContaining({
            message: expect.stringMatching(/unexpected/gi),
          }),
        ],
      }),
    ]);

    AWSMock.restore('EC2');
  });

  it('errors if State.Name was not returned by AWS', async () => {
    AWSMock.setSDKInstance(AWS);

    AWSMock.mock(
      'EC2',
      'describeInstances',
      (params: AWS.EC2.Types.DescribeInstancesRequest, callback: Function) => {
        callback(null, {
          Reservations: [
            { Instances: [{ InstanceId: 'foo', State: { Code: 11 } }] },
          ],
        } as AWS.EC2.Types.DescribeInstancesResult);
      },
    );

    const instance = new ShutdownEC2InstancesTrick();
    const stateObject: ShutdownEC2InstancesState = [];
    const listr = await instance.getCurrentState(
      task,
      { resourceTagMappings: [] } as TrickContext,
      stateObject,
      {
        dryRun: false,
      },
    );

    await listr.run();

    expect(listr.err).toStrictEqual([
      expect.objectContaining({
        errors: [
          expect.objectContaining({
            message: expect.stringMatching(/unexpected/gi),
          }),
        ],
      }),
    ]);

    AWSMock.restore('EC2');
  });

  it('generates state object for ec2 instances', async () => {
    AWSMock.setSDKInstance(AWS);

    AWSMock.mock(
      'EC2',
      'describeInstances',
      (params: AWS.EC2.Types.DescribeInstancesRequest, callback: Function) => {
        callback(null, {
          Reservations: [
            {
              Instances: [
                { InstanceId: 'foo', State: { Name: 'running' } },
                {
                  InstanceId: 'bar',
                  State: { Name: 'stopping' },
                  Tags: [{ Value: 'barname', Key: 'Name' }],
                },
              ],
            },
            {
              Instances: [
                { InstanceId: 'baz', State: { Name: 'pending' } },
                {
                  InstanceId: 'qux',
                  State: { Name: 'running' },
                  Tags: [{ Value: 'quxname', Key: 'Name' }],
                },
              ],
            },
          ],
        } as AWS.EC2.Types.DescribeInstancesResult);
      },
    );

    const instance = new ShutdownEC2InstancesTrick();
    const stateObject: ShutdownEC2InstancesState = [];
    const listr = await instance.getCurrentState(
      task,
      { resourceTagMappings: [] } as TrickContext,
      stateObject,
      {
        dryRun: false,
      },
    );

    await listr.run({});

    expect(stateObject).toMatchObject([
      {
        id: 'foo',
        state: 'running',
        name: expect.anything(),
      },
      {
        id: 'bar',
        state: 'stopping',
        name: 'barname',
      },
      {
        id: 'baz',
        state: 'pending',
        name: expect.anything(),
      },
      {
        id: 'qux',
        state: 'running',
        name: 'quxname',
      },
    ] as ShutdownEC2InstancesState);

    AWSMock.restore('EC2');
  });

  it('generates state object for tagged resources', async () => {
    AWSMock.setSDKInstance(AWS);

    const describeInstancesSpy = jest
      .fn()
      .mockImplementationOnce(
        (
          params: AWS.EC2.Types.DescribeInstancesRequest,
          callback: Function,
        ) => {
          callback(null, {
            Reservations: [
              {
                Instances: [
                  {
                    InstanceId: 'bar',
                    State: { Name: 'running' },
                    Tags: [{ Value: 'barname', Key: 'Name' }],
                  },
                ],
              },
            ],
          } as AWS.EC2.Types.DescribeInstancesResult);
        },
      );
    AWSMock.mock('EC2', 'describeInstances', describeInstancesSpy);

    const instance = new ShutdownEC2InstancesTrick();
    const stateObject: ShutdownEC2InstancesState = [];
    const listr = await instance.getCurrentState(
      task,
      { resourceTagMappings: [] } as TrickContext,
      stateObject,
      {
        tags: [{ Key: 'Name', Values: ['barname'] }],
        dryRun: false,
      },
    );

    await listr.run({});

    expect(describeInstancesSpy).toBeCalledWith(
      expect.objectContaining({
        Filters: [{ Name: 'tag:Name', Values: ['barname'] }],
        MaxResults: 1000,
      } as AWS.EC2.Types.DescribeInstancesRequest),
      expect.any(Function),
    );
    expect(stateObject.length).toBe(1);
    expect(stateObject).toMatchObject([
      {
        id: 'bar',
        state: 'running',
        name: 'barname',
      },
    ] as ShutdownEC2InstancesState);

    AWSMock.restore('EC2');
  });

  it('conserves running ec2 instances', async () => {
    AWSMock.setSDKInstance(AWS);

    const stopInstancesSpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback(null, {});
      });
    AWSMock.mock('EC2', 'stopInstances', stopInstancesSpy);

    const instance = new ShutdownEC2InstancesTrick();
    const stateObject: ShutdownEC2InstancesState = [
      {
        id: 'foo',
        state: 'running',
        name: 'fooname',
      },
    ];
    const conserveListr = await instance.conserve(task, stateObject, {
      dryRun: false,
    });

    await conserveListr.run({});

    expect(stopInstancesSpy).toBeCalledWith(
      expect.objectContaining({
        InstanceIds: ['foo'],
      }),
      expect.anything(),
    );

    AWSMock.restore('EC2');
  });

  it('skips conserve for non-running ec2 instances', async () => {
    AWSMock.setSDKInstance(AWS);

    const stopInstancesSpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback(null, {});
      });
    AWSMock.mock('EC2', 'stopInstances', stopInstancesSpy);

    const instance = new ShutdownEC2InstancesTrick();
    const stateObject: ShutdownEC2InstancesState = [
      {
        id: 'foo',
        state: 'stopping',
        name: 'fooname',
      },
      {
        id: 'bar',
        state: 'pending',
        name: 'barname',
      },
    ];
    const conserveListr = await instance.conserve(task, stateObject, {
      dryRun: false,
    });

    await conserveListr.run({});

    expect(stopInstancesSpy).not.toBeCalled();

    AWSMock.restore('EC2');
  });

  it('skips conserve if no ec2 instances are found', async () => {
    AWSMock.setSDKInstance(AWS);

    const instance = new ShutdownEC2InstancesTrick();
    const stateObject: ShutdownEC2InstancesState = [];

    const stopInstancesSpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback(null, {});
      });
    AWSMock.mock('EC2', 'stopInstances', stopInstancesSpy);

    await instance.conserve(task, stateObject, {
      dryRun: false,
    });

    expect(stopInstancesSpy).not.toBeCalled();
    expect(task.skip).toBeCalledWith(expect.any(String));

    AWSMock.restore('EC2');
  });

  it('skips conserve for ec2 instance if dry-run option is enabled', async () => {
    AWSMock.setSDKInstance(AWS);

    const stopInstancesSpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback(null, {});
      });
    AWSMock.mock('EC2', 'stopInstances', stopInstancesSpy);

    const instance = new ShutdownEC2InstancesTrick();
    const stateObject: ShutdownEC2InstancesState = [
      {
        id: 'foo',
        state: 'running',
        name: 'fooname',
      },
    ];

    const conserveListr = await instance.conserve(task, stateObject, {
      dryRun: true,
    });

    await conserveListr.run({});

    expect(stopInstancesSpy).not.toBeCalled();

    AWSMock.restore('EC2');
  });

  it('restores stopped ec2 instance', async () => {
    AWSMock.setSDKInstance(AWS);

    const startInstancesSpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback(null, {});
      });
    AWSMock.mock('EC2', 'startInstances', startInstancesSpy);

    const instance = new ShutdownEC2InstancesTrick();
    const stateObject: ShutdownEC2InstancesState = [
      {
        id: 'foo',
        state: 'running',
        name: 'foobar',
      },
    ];
    const restoreListr = await instance.restore(task, stateObject, {
      dryRun: false,
    });

    await restoreListr.run({});

    expect(startInstancesSpy).toBeCalledWith(
      expect.objectContaining({
        InstanceIds: ['foo'],
      }),
      expect.anything(),
    );

    AWSMock.restore('EC2');
  });

  it('skips restore if no databases were conserved', async () => {
    const instance = new ShutdownEC2InstancesTrick();
    const stateObject: ShutdownEC2InstancesState = [];

    await instance.restore(task, stateObject, {
      dryRun: false,
    });
    expect(task.skip).toBeCalledWith(expect.any(String));
  });

  it('skips restore for ec2 instance if original status was not "running"', async () => {
    AWSMock.setSDKInstance(AWS);

    const startInstancesSpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback(null, {});
      });
    AWSMock.mock('EC2', 'startInstances', startInstancesSpy);

    const instance = new ShutdownEC2InstancesTrick();
    const stateObject: ShutdownEC2InstancesState = [
      {
        id: 'foo',
        state: 'stopped',
        name: 'fooname',
      },
    ];

    const restoreListr = await instance.restore(task, stateObject, {
      dryRun: false,
    });

    await restoreListr.run({});

    expect(startInstancesSpy).not.toBeCalled();

    AWSMock.restore('EC2');
  });

  it('skips restore for database if dry-run option is enabled', async () => {
    AWSMock.setSDKInstance(AWS);

    const startInstancesSpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback(null, {});
      });
    AWSMock.mock('EC2', 'startInstances', startInstancesSpy);

    const instance = new ShutdownEC2InstancesTrick();
    const stateObject: ShutdownEC2InstancesState = [
      {
        id: 'foo',
        state: 'running',
        name: 'fooname',
      },
    ];

    const restoreListr = await instance.restore(task, stateObject, {
      dryRun: true,
    });

    await restoreListr.run({});

    expect(startInstancesSpy).not.toBeCalled();

    AWSMock.restore('EC2');
  });
});
