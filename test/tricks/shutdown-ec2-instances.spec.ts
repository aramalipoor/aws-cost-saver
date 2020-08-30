import AWS from 'aws-sdk';
import AWSMock from 'aws-sdk-mock';

import { ListrTaskWrapper } from 'listr';

import {
  ShutdownEC2InstancesTrick,
  ShutdownEC2InstancesState,
} from '../../src/tricks/shutdown-ec2-instances.trick';

beforeAll(async done => {
  // AWSMock cannot mock waiters at the moment
  AWS.EC2.prototype.waitFor = jest.fn().mockImplementation(() => ({
    promise: jest.fn(),
  }));

  done();
});

describe('shutdown-ec2-instances', () => {
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
    const instance = new ShutdownEC2InstancesTrick();
    expect(instance.getMachineName()).toBe(
      ShutdownEC2InstancesTrick.machineName,
    );
  });

  it('returns different title for conserve and restore commands', async () => {
    const instance = new ShutdownEC2InstancesTrick();
    expect(instance.getConserveTitle()).not.toBe(instance.getRestoreTitle());
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
    const listr = await instance.getCurrentState(task, stateObject, {
      dryRun: false,
    });

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
    const listr = await instance.getCurrentState(task, stateObject, {
      dryRun: false,
    });

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
    const listr = await instance.getCurrentState(task, stateObject, {
      dryRun: false,
    });

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
    const listr = await instance.getCurrentState(task, stateObject, {
      dryRun: false,
    });
    listr.setRenderer('silent');

    await expect(async () => listr.run()).rejects.toMatchObject({
      errors: expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringMatching(/unexpected ec2 instance/gi),
        }),
      ]),
    });

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
    const listr = await instance.getCurrentState(task, stateObject, {
      dryRun: false,
    });
    listr.setRenderer('silent');

    await expect(async () => listr.run()).rejects.toMatchObject({
      errors: expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringMatching(/unexpected ec2 instance/gi),
        }),
      ]),
    });

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
    const listr = await instance.getCurrentState(task, stateObject, {
      dryRun: false,
    });
    listr.setRenderer('silent');

    await expect(async () => listr.run()).rejects.toMatchObject({
      errors: expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringMatching(/unexpected ec2 instance/gi),
        }),
      ]),
    });

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
    const listr = await instance.getCurrentState(task, stateObject, {
      dryRun: false,
    });

    listr.setRenderer('silent');
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
    conserveListr.setRenderer('silent');
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
    conserveListr.setRenderer('silent');
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
    conserveListr.setRenderer('silent');
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
    restoreListr.setRenderer('silent');
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
    restoreListr.setRenderer('silent');
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
    restoreListr.setRenderer('silent');
    await restoreListr.run({});

    expect(startInstancesSpy).not.toBeCalled();

    AWSMock.restore('EC2');
  });
});
