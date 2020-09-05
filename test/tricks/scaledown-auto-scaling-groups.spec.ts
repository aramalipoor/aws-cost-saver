import AWS from 'aws-sdk';
import AWSMock from 'aws-sdk-mock';
import { mockProcessStdout } from 'jest-mock-process';
import { ListrTaskWrapper } from 'listr2';

import {
  ScaledownAutoScalingGroupsTrick,
  ScaledownAutoScalingGroupsState,
} from '../../src/tricks/scaledown-auto-scaling-groups.trick';
import { AutoScalingGroupState } from '../../src/states/auto-scaling-group.state';
import { createMockTask } from '../util';

beforeAll(async done => {
  mockProcessStdout();
  done();
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
    await instance.getCurrentState(task, stateObject, {
      dryRun: false,
    });

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
    await instance.getCurrentState(task, stateObject, {
      dryRun: false,
    });

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
