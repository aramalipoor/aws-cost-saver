import AWS from 'aws-sdk';
import AWSMock from 'aws-sdk-mock';
import { mockProcessStdout } from 'jest-mock-process';
import { ListrTaskWrapper } from 'listr2';
import nock from 'nock';

import {
  ScaledownAutoScalingGroupsTrick,
  ScaledownAutoScalingGroupsState,
} from '../../src/tricks/scaledown-auto-scaling-groups.trick';
import { TrickContext } from '../../src/types/trick-context';
import { AutoScalingGroupState } from '../../src/states/auto-scaling-group.state';
import { createMockTask } from '../util';

beforeAll(async done => {
  nock.abortPendingRequests();
  nock.cleanAll();
  nock.disableNetConnect();

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

describe('scaledown-auto-scaling-groups', () => {
  let task: ListrTaskWrapper<any, any>;

  beforeEach(() => {
    task = createMockTask();
  });

  it('returns correct machine name', async () => {
    const instance = new ScaledownAutoScalingGroupsTrick();
    expect(instance.getMachineName()).toBe(
      ScaledownAutoScalingGroupsTrick.machineName,
    );
  });

  it('skips preparing tags', async () => {
    const instance = new ScaledownAutoScalingGroupsTrick();
    await instance.prepareTags(task, {} as TrickContext, {
      dryRun: false,
    });
    expect(task.skip).toBeCalled();
  });

  it('returns an empty state object if no ASG found', async () => {
    AWSMock.setSDKInstance(AWS);

    AWSMock.mock(
      'AutoScaling',
      'describeAutoScalingGroups',
      (
        params: AWS.AutoScaling.Types.AutoScalingGroupNamesType,
        callback: Function,
      ) => {
        callback(null, {
          AutoScalingGroups: [],
        } as AWS.AutoScaling.Types.AutoScalingGroupsType);
      },
    );

    const instance = new ScaledownAutoScalingGroupsTrick();
    const stateObject: ScaledownAutoScalingGroupsState = [];
    await instance.getCurrentState(
      task,
      { resourceTagMappings: [] } as TrickContext,
      stateObject,
      {
        dryRun: false,
      },
    );

    expect(stateObject.length).toBe(0);

    AWSMock.restore('AutoScaling');
  });

  it('generates state object for Auto Scaling Groups', async () => {
    AWSMock.setSDKInstance(AWS);

    AWSMock.mock(
      'AutoScaling',
      'describeAutoScalingGroups',
      (
        params: AWS.AutoScaling.Types.AutoScalingGroupNamesType,
        callback: Function,
      ) => {
        callback(null, {
          AutoScalingGroups: [
            {
              AutoScalingGroupName: 'foo',
              MinSize: 1,
              MaxSize: 10,
              DesiredCapacity: 3,
            },
          ],
        } as AWS.AutoScaling.Types.AutoScalingGroupsType);
      },
    );

    const instance = new ScaledownAutoScalingGroupsTrick();
    const stateObject: ScaledownAutoScalingGroupsState = [];
    await instance.getCurrentState(
      task,
      { resourceTagMappings: [] } as TrickContext,
      stateObject,
      {
        dryRun: false,
      },
    );

    expect(stateObject).toStrictEqual(
      expect.objectContaining([
        {
          name: 'foo',
          desired: 3,
          min: 1,
          max: 10,
        } as AutoScalingGroupState,
      ]),
    );

    AWSMock.restore('AutoScaling');
  });

  it('generates state object for tagged resources', async () => {
    AWSMock.setSDKInstance(AWS);

    AWSMock.mock(
      'AutoScaling',
      'describeAutoScalingGroups',
      (
        params: AWS.AutoScaling.Types.AutoScalingGroupNamesType,
        callback: Function,
      ) => {
        callback(null, {
          AutoScalingGroups: [
            {
              AutoScalingGroupName: 'foo',
              MinSize: 1,
              MaxSize: 10,
              DesiredCapacity: 3,
            },
            {
              AutoScalingGroupName: 'bar',
              MinSize: 3,
              MaxSize: 6,
              DesiredCapacity: 3,
              Tags: [{ Key: 'Team', Value: 'Tacos' }],
            },
            {
              AutoScalingGroupName: 'baz',
              MinSize: 1,
              MaxSize: 10,
              DesiredCapacity: 3,
              Tags: [{ Key: 'Team', Value: 'Chimichanga' }],
            },
          ],
        } as AWS.AutoScaling.Types.AutoScalingGroupsType);
      },
    );

    const instance = new ScaledownAutoScalingGroupsTrick();
    const stateObject: ScaledownAutoScalingGroupsState = [];
    await instance.getCurrentState(
      task,
      { resourceTagMappings: [] } as TrickContext,
      stateObject,
      {
        tags: [{ Key: 'Team', Values: ['Tacos'] }],
        dryRun: false,
      },
    );

    expect(stateObject.length).toBe(1);
    expect(stateObject).toStrictEqual(
      expect.objectContaining([
        {
          name: 'bar',
          desired: 3,
          min: 3,
          max: 6,
        } as AutoScalingGroupState,
      ]),
    );

    AWSMock.restore('AutoScaling');
  });

  it('conserves available auto scaling groups', async () => {
    AWSMock.setSDKInstance(AWS);

    const updateAutoScalingGroupSpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback(null, {});
      });
    AWSMock.mock(
      'AutoScaling',
      'updateAutoScalingGroup',
      updateAutoScalingGroupSpy,
    );

    const instance = new ScaledownAutoScalingGroupsTrick();
    const stateObject: ScaledownAutoScalingGroupsState = [
      {
        name: 'foo',
        desired: 3,
        min: 1,
        max: 10,
      },
    ];
    const conserveListr = await instance.conserve(task, stateObject, {
      dryRun: false,
    });

    await conserveListr.run({});

    expect(updateAutoScalingGroupSpy).toBeCalledWith(
      expect.objectContaining({
        AutoScalingGroupName: 'foo',
        DesiredCapacity: 0,
        MaxSize: 0,
        MinSize: 0,
      }),
      expect.anything(),
    );

    AWSMock.restore('AutoScaling');
  });

  it('skips conserve if no ASGs are found', async () => {
    AWSMock.setSDKInstance(AWS);

    const instance = new ScaledownAutoScalingGroupsTrick();
    const stateObject: ScaledownAutoScalingGroupsState = [];

    const updateAutoScalingGroupSpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback(null, {});
      });
    AWSMock.mock(
      'AutoScaling',
      'updateAutoScalingGroup',
      updateAutoScalingGroupSpy,
    );

    await instance.conserve(task, stateObject, {
      dryRun: false,
    });

    expect(updateAutoScalingGroupSpy).not.toBeCalled();
    expect(task.skip).toBeCalledWith(expect.any(String));

    AWSMock.restore('AutoScaling');
  });

  it('skips conserve if dry-run option is enabled', async () => {
    AWSMock.setSDKInstance(AWS);

    const updateAutoScalingGroupSpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback(null, {});
      });
    AWSMock.mock(
      'AutoScaling',
      'updateAutoScalingGroup',
      updateAutoScalingGroupSpy,
    );

    const instance = new ScaledownAutoScalingGroupsTrick();
    const stateObject: ScaledownAutoScalingGroupsState = [
      {
        name: 'foo',
        desired: 3,
        min: 1,
        max: 10,
      },
    ];

    const conserveListr = await instance.conserve(task, stateObject, {
      dryRun: true,
    });

    await conserveListr.run({});

    expect(updateAutoScalingGroupSpy).not.toBeCalled();

    AWSMock.restore('AutoScaling');
  });

  it('restores scaled-down auto scaling groups', async () => {
    AWSMock.setSDKInstance(AWS);

    const updateAutoScalingGroupSpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback(null, {});
      });
    AWSMock.mock(
      'AutoScaling',
      'updateAutoScalingGroup',
      updateAutoScalingGroupSpy,
    );

    const instance = new ScaledownAutoScalingGroupsTrick();
    const stateObject: ScaledownAutoScalingGroupsState = [
      {
        name: 'foo',
        desired: 3,
        min: 1,
        max: 10,
      },
    ];
    const restoreListr = await instance.restore(task, stateObject, {
      dryRun: false,
    });

    await restoreListr.run({});

    expect(updateAutoScalingGroupSpy).toBeCalledWith(
      expect.objectContaining({
        AutoScalingGroupName: 'foo',
        DesiredCapacity: 3,
        MaxSize: 10,
        MinSize: 1,
      }),
      expect.anything(),
    );

    AWSMock.restore('AutoScaling');
  });

  it('skips restore if no ASGS were conserved', async () => {
    AWSMock.setSDKInstance(AWS);

    const updateAutoScalingGroupSpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback(null, {});
      });
    AWSMock.mock(
      'AutoScaling',
      'updateAutoScalingGroup',
      updateAutoScalingGroupSpy,
    );

    const instance = new ScaledownAutoScalingGroupsTrick();
    const stateObject: ScaledownAutoScalingGroupsState = [];

    await instance.restore(task, stateObject, {
      dryRun: false,
    });

    expect(updateAutoScalingGroupSpy).not.toBeCalled();
    expect(task.skip).toBeCalledWith(expect.any(String));

    AWSMock.restore('AutoScaling');
  });

  it('skips restore if dry-run option is enabled', async () => {
    AWSMock.setSDKInstance(AWS);

    const updateAutoScalingGroupSpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback(null, {});
      });
    AWSMock.mock(
      'AutoScaling',
      'updateAutoScalingGroup',
      updateAutoScalingGroupSpy,
    );

    const instance = new ScaledownAutoScalingGroupsTrick();
    const stateObject: ScaledownAutoScalingGroupsState = [
      {
        name: 'foo',
        desired: 3,
        min: 1,
        max: 10,
      },
    ];

    const restoreListr = await instance.restore(task, stateObject, {
      dryRun: true,
    });

    await restoreListr.run({});

    expect(updateAutoScalingGroupSpy).not.toBeCalled();

    AWSMock.restore('AutoScaling');
  });
});
