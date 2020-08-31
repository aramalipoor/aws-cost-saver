import AWS from 'aws-sdk';
import AWSMock from 'aws-sdk-mock';

import { ListrTaskWrapper } from 'listr';

import {
  SuspendAutoScalingGroupsTrick,
  SuspendAutoScalingGroupsState,
} from '../../src/tricks/suspend-auto-scaling-groups.trick';
import { AutoScalingGroupState } from '../../src/states/auto-scaling-group.state';

beforeAll(async done => {
  done();
});

describe('suspend-auto-scaling-groups', () => {
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
    const instance = new SuspendAutoScalingGroupsTrick();
    expect(instance.getMachineName()).toBe(
      SuspendAutoScalingGroupsTrick.machineName,
    );
  });

  it('returns different title for conserve and restore commands', async () => {
    const instance = new SuspendAutoScalingGroupsTrick();
    expect(instance.getConserveTitle()).not.toBe(instance.getRestoreTitle());
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

    const instance = new SuspendAutoScalingGroupsTrick();
    const stateObject: SuspendAutoScalingGroupsState = [];
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
            },
          ],
        } as AWS.AutoScaling.Types.AutoScalingGroupsType);
      },
    );

    const instance = new SuspendAutoScalingGroupsTrick();
    const stateObject: SuspendAutoScalingGroupsState = [];
    await instance.getCurrentState(task, stateObject, {
      dryRun: false,
    });

    expect(stateObject).toStrictEqual(
      expect.objectContaining([
        {
          name: 'foo',
        } as AutoScalingGroupState,
      ]),
    );

    AWSMock.restore('AutoScaling');
  });

  it('conserves available auto scaling groups', async () => {
    AWSMock.setSDKInstance(AWS);

    const suspendProcessesSpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback(null, {});
      });
    AWSMock.mock('AutoScaling', 'suspendProcesses', suspendProcessesSpy);

    const instance = new SuspendAutoScalingGroupsTrick();
    const stateObject: SuspendAutoScalingGroupsState = [
      {
        name: 'foo',
      },
    ];
    const conserveListr = await instance.conserve(task, stateObject, {
      dryRun: false,
    });
    conserveListr.setRenderer('silent');
    await conserveListr.run({});

    expect(suspendProcessesSpy).toBeCalledWith(
      expect.objectContaining({
        AutoScalingGroupName: 'foo',
      }),
      expect.anything(),
    );

    AWSMock.restore('AutoScaling');
  });

  it('skips conserve if no ASGs are found', async () => {
    AWSMock.setSDKInstance(AWS);

    const instance = new SuspendAutoScalingGroupsTrick();
    const stateObject: SuspendAutoScalingGroupsState = [];

    const suspendProcessesSpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback(null, {});
      });
    AWSMock.mock('AutoScaling', 'suspendProcesses', suspendProcessesSpy);

    await instance.conserve(task, stateObject, {
      dryRun: false,
    });

    expect(suspendProcessesSpy).not.toBeCalled();
    expect(task.skip).toBeCalledWith(expect.any(String));

    AWSMock.restore('AutoScaling');
  });

  it('skips conserve if dry-run option is enabled', async () => {
    AWSMock.setSDKInstance(AWS);

    const suspendProcessesSpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback(null, {});
      });
    AWSMock.mock('AutoScaling', 'suspendProcesses', suspendProcessesSpy);

    const instance = new SuspendAutoScalingGroupsTrick();
    const stateObject: SuspendAutoScalingGroupsState = [
      {
        name: 'foo',
      },
    ];

    const conserveListr = await instance.conserve(task, stateObject, {
      dryRun: true,
    });
    conserveListr.setRenderer('silent');
    await conserveListr.run({});

    expect(suspendProcessesSpy).not.toBeCalled();

    AWSMock.restore('AutoScaling');
  });

  it('restores scaled-down auto scaling groups', async () => {
    AWSMock.setSDKInstance(AWS);

    const resumeProcessesSpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback(null, {});
      });
    AWSMock.mock('AutoScaling', 'resumeProcesses', resumeProcessesSpy);

    const instance = new SuspendAutoScalingGroupsTrick();
    const stateObject: SuspendAutoScalingGroupsState = [
      {
        name: 'foo',
      },
    ];
    const restoreListr = await instance.restore(task, stateObject, {
      dryRun: false,
    });
    restoreListr.setRenderer('silent');
    await restoreListr.run({});

    expect(resumeProcessesSpy).toBeCalledWith(
      expect.objectContaining({
        AutoScalingGroupName: 'foo',
      }),
      expect.anything(),
    );

    AWSMock.restore('AutoScaling');
  });

  it('skips restore if no ASGS were conserved', async () => {
    AWSMock.setSDKInstance(AWS);

    const resumeProcessesSpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback(null, {});
      });
    AWSMock.mock('AutoScaling', 'resumeProcesses', resumeProcessesSpy);

    const instance = new SuspendAutoScalingGroupsTrick();
    const stateObject: SuspendAutoScalingGroupsState = [];

    await instance.restore(task, stateObject, {
      dryRun: false,
    });

    expect(resumeProcessesSpy).not.toBeCalled();
    expect(task.skip).toBeCalledWith(expect.any(String));

    AWSMock.restore('AutoScaling');
  });

  it('skips restore if dry-run option is enabled', async () => {
    AWSMock.setSDKInstance(AWS);

    const resumeProcessesSpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback(null, {});
      });
    AWSMock.mock('AutoScaling', 'resumeProcesses', resumeProcessesSpy);

    const instance = new SuspendAutoScalingGroupsTrick();
    const stateObject: SuspendAutoScalingGroupsState = [
      {
        name: 'foo',
      },
    ];

    const restoreListr = await instance.restore(task, stateObject, {
      dryRun: true,
    });
    restoreListr.setRenderer('silent');
    await restoreListr.run({});

    expect(resumeProcessesSpy).not.toBeCalled();

    AWSMock.restore('AutoScaling');
  });
});
