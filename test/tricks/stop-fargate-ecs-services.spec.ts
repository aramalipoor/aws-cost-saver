import AWS from 'aws-sdk';
import AWSMock from 'aws-sdk-mock';

import { ListrTaskWrapper } from 'listr';

import {
  StopFargateEcsServicesTrick,
  StopFargateEcsServicesState,
} from '../../src/tricks/stop-fargate-ecs-services.trick';

beforeAll(async done => {
  // AWSMock cannot mock waiters at the moment
  AWS.ECS.prototype.waitFor = jest.fn().mockImplementation(() => ({
    promise: jest.fn(),
  }));

  done();
});

describe('stop-fargate-ecs-services', () => {
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
    const instance = new StopFargateEcsServicesTrick();
    expect(instance.getMachineName()).toBe(
      StopFargateEcsServicesTrick.machineName,
    );
  });

  it('returns different title for conserve and restore commands', async () => {
    const instance = new StopFargateEcsServicesTrick();
    expect(instance.getConserveTitle()).not.toBe(instance.getRestoreTitle());
  });

  it('returns an empty Listr if no clusters found', async () => {
    AWSMock.setSDKInstance(AWS);

    AWSMock.mock(
      'ECS',
      'listClusters',
      (params: AWS.ECS.Types.ListClustersRequest, callback: Function) => {
        callback(null, {
          clusterArns: [],
        } as AWS.ECS.Types.ListClustersResponse);
      },
    );

    const instance = new StopFargateEcsServicesTrick();
    const stateObject: StopFargateEcsServicesState = [];
    const listr = await instance.getCurrentState(task, stateObject, {
      dryRun: false,
    });

    expect(listr.tasks.length).toBe(0);

    AWSMock.restore('ECS');
  });

  it('returns an empty state if no services found', async () => {
    AWSMock.setSDKInstance(AWS);

    AWSMock.mock(
      'ECS',
      'listClusters',
      (params: AWS.ECS.Types.ListClustersRequest, callback: Function) => {
        callback(null, {
          clusterArns: ['arn:cluster/foo', 'arn:cluster/bar'],
        } as AWS.ECS.Types.ListClustersResponse);
      },
    );

    AWSMock.mock(
      'ECS',
      'listServices',
      (params: AWS.ECS.Types.ListServicesRequest, callback: Function) => {
        if (params.cluster === 'arn:cluster/foo') {
          callback(null, {
            serviceArns: [],
          } as AWS.ECS.Types.ListServicesResponse);
        } else if (params.cluster === 'arn:cluster/bar') {
          callback(null, {
            serviceArns: [],
          } as AWS.ECS.Types.ListServicesResponse);
        } else {
          throw new Error(`Wrong cluster arn`);
        }
      },
    );

    const instance = new StopFargateEcsServicesTrick();
    const stateObject: StopFargateEcsServicesState = [];
    const stateListr = await instance.getCurrentState(task, stateObject, {
      dryRun: false,
    });
    stateListr.setRenderer('silent');
    await stateListr.run();

    expect(stateObject.length).toBe(2);
    expect(stateObject[0].services.length).toBe(0);
    expect(stateObject[1].services.length).toBe(0);

    AWSMock.restore('ECS');
  });

  it('errors if serviceArn was not returned by AWS', async () => {
    AWSMock.setSDKInstance(AWS);

    AWSMock.mock(
      'ECS',
      'listClusters',
      (params: AWS.ECS.Types.ListClustersRequest, callback: Function) => {
        callback(null, {
          clusterArns: ['arn:cluster/foo'],
        } as AWS.ECS.Types.ListClustersResponse);
      },
    );

    AWSMock.mock(
      'ECS',
      'listServices',
      (params: AWS.ECS.Types.ListServicesRequest, callback: Function) => {
        if (params.cluster === 'arn:cluster/foo') {
          callback(null, {
            serviceArns: ['arn:service/bar'],
          } as AWS.ECS.Types.ListServicesResponse);
        } else {
          throw new Error(`Wrong cluster arn`);
        }
      },
    );

    AWSMock.mock(
      'ECS',
      'describeServices',
      (params: AWS.ECS.Types.DescribeServicesRequest, callback: Function) => {
        if (params.services.includes('arn:service/bar')) {
          callback(null, {
            services: [{ desiredCount: 3 }],
          } as AWS.ECS.Types.DescribeServicesResponse);
        } else {
          throw new Error(`Wrong service arn`);
        }
      },
    );

    const instance = new StopFargateEcsServicesTrick();
    const stateObject: StopFargateEcsServicesState = [];
    const listr = await instance.getCurrentState(task, stateObject, {
      dryRun: false,
    });

    await expect(async () => listr.run()).rejects.toThrow();

    AWSMock.restore('ECS');
  });

  it('generates state object for ec2 instances', async () => {
    AWSMock.setSDKInstance(AWS);

    AWSMock.mock(
      'ECS',
      'listClusters',
      (params: AWS.ECS.Types.ListClustersRequest, callback: Function) => {
        callback(null, {
          clusterArns: ['arn:cluster/foo', 'arn:cluster/bar'],
        } as AWS.ECS.Types.ListClustersResponse);
      },
    );

    AWSMock.mock(
      'ECS',
      'listServices',
      (params: AWS.ECS.Types.ListServicesRequest, callback: Function) => {
        if (params.cluster === 'arn:cluster/foo') {
          callback(null, {
            serviceArns: ['arn:service/baz', 'arn:service/qux'],
          } as AWS.ECS.Types.ListServicesResponse);
        } else if (params.cluster === 'arn:cluster/bar') {
          callback(null, {
            serviceArns: ['arn:service/quux', 'arn:service/quuz'],
          } as AWS.ECS.Types.ListServicesResponse);
        } else {
          throw new Error(`Wrong cluster arn`);
        }
      },
    );

    AWSMock.mock(
      'ECS',
      'describeServices',
      (params: AWS.ECS.Types.DescribeServicesRequest, callback: Function) => {
        const response: AWS.ECS.Types.DescribeServicesResponse = {
          services: [],
        };
        const services = [];

        if (params.services.includes('arn:service/baz')) {
          services.push({
            serviceArn: 'arn:service/baz',
            desiredCount: 3,
          });
        }
        if (params.services.includes('arn:service/qux')) {
          services.push({
            serviceArn: 'arn:service/qux',
            desiredCount: 1,
          });
        }
        if (params.services.includes('arn:service/quux')) {
          services.push({
            serviceArn: 'arn:service/quux',
            desiredCount: 0,
          });
        }
        if (params.services.includes('arn:service/quuz')) {
          services.push({
            serviceArn: 'arn:service/quuz',
            desiredCount: 10,
          });
        }

        if (services.length === 0) {
          throw new Error(`Wrong service arn`);
        }

        response.services = services;

        callback(null, response);
      },
    );

    AWSMock.mock(
      'ApplicationAutoScaling',
      'describeScalableTargets',
      (
        params: AWS.ApplicationAutoScaling.Types.DescribeScalableTargetsRequest,
        callback: (
          err: any,
          res:
            | AWS.ApplicationAutoScaling.Types.DescribeScalableTargetsResponse
            | any,
        ) => {},
      ) => {
        if (params.ResourceIds?.includes('service/foo/baz')) {
          callback(null, {
            ScalableTargets: [
              {
                MinCapacity: 2,
                MaxCapacity: 8,
                ScalableDimension: 'ecs:service:DesiredCount',
                ResourceId: 'service/foo/baz',
              },
            ],
          });
        } else if (params.ResourceIds?.includes('service/foo/qux')) {
          callback(null, {});
        } else if (params.ResourceIds?.includes('service/bar/quux')) {
          callback(null, {
            ScalableTargets: [],
          });
        } else if (params.ResourceIds?.includes('service/bar/quuz')) {
          callback(null, {
            ScalableTargets: [
              {
                MinCapacity: 0,
                MaxCapacity: 20,
                ScalableDimension: 'ecs:service:DesiredCount',
                ResourceId: 'service/bar/quuz',
              },
            ],
          });
        } else {
          throw new Error(`Wrong service arn when fetching scalabale targets`);
        }
      },
    );

    const instance = new StopFargateEcsServicesTrick();
    const stateObject: StopFargateEcsServicesState = [];
    const listr = await instance.getCurrentState(task, stateObject, {
      dryRun: false,
    });

    listr.setRenderer('silent');
    await listr.run({});

    expect(stateObject).toStrictEqual([
      {
        arn: 'arn:cluster/foo',
        services: [
          {
            arn: 'arn:service/baz',
            desired: 3,
            scalableTargets: [
              {
                min: 2,
                max: 8,
                scalableDimension: 'ecs:service:DesiredCount',
                resourceId: 'service/foo/baz',
                namespace: 'ecs',
              },
            ],
          },
          {
            arn: 'arn:service/qux',
            desired: 1,
            scalableTargets: [],
          },
        ],
      },
      {
        arn: 'arn:cluster/bar',
        services: [
          {
            arn: 'arn:service/quux',
            desired: 0,
            scalableTargets: [],
          },
          {
            arn: 'arn:service/quuz',
            desired: 10,
            scalableTargets: [
              {
                min: 0,
                max: 20,
                scalableDimension: 'ecs:service:DesiredCount',
                resourceId: 'service/bar/quuz',
                namespace: 'ecs',
              },
            ],
          },
        ],
      },
    ] as StopFargateEcsServicesState);

    AWSMock.restore('ECS');
  });

  it('conserves running ec2 instances', async () => {
    AWSMock.setSDKInstance(AWS);

    const updateServiceSpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback(null, {});
      });
    AWSMock.mock('ECS', 'updateService', updateServiceSpy);

    const registerScalableTargetSpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback(null, {});
      });
    AWSMock.mock(
      'ApplicationAutoScaling',
      'registerScalableTarget',
      registerScalableTargetSpy,
    );

    const instance = new StopFargateEcsServicesTrick();
    const stateObject: StopFargateEcsServicesState = [
      {
        arn: 'arn:cluster/foo',
        services: [
          {
            arn: 'arn:service/bar',
            desired: 3,
            scalableTargets: [
              {
                namespace: 'ecs',
                resourceId: 'service/foor/bar',
                scalableDimension: 'ecs:service:DesiredCount',
                min: 1,
                max: 10,
              },
            ],
          },
        ],
      },
    ];
    const conserveListr = await instance.conserve(task, stateObject, {
      dryRun: false,
    });
    conserveListr.setRenderer('silent');
    await conserveListr.run({});

    expect(updateServiceSpy).toBeCalledWith(
      expect.objectContaining({
        cluster: 'arn:cluster/foo',
        service: 'arn:service/bar',
        desiredCount: 0,
      }),
      expect.anything(),
    );

    expect(registerScalableTargetSpy).toBeCalledWith(
      expect.objectContaining({
        ServiceNamespace: 'ecs',
        ResourceId: 'service/foo/bar',
        ScalableDimension: 'ecs:service:DesiredCount',
        MinCapacity: 0,
        MaxCapacity: 0,
      }),
      expect.anything(),
    );

    AWSMock.restore('ECS');
    AWSMock.restore('ApplicationAutoScaling');
  });

  it('skips conserve when desired count is already zero', async () => {
    AWSMock.setSDKInstance(AWS);

    const updateServiceSpy = jest.fn();
    AWSMock.mock('ECS', 'updateService', updateServiceSpy);

    const instance = new StopFargateEcsServicesTrick();
    const stateObject: StopFargateEcsServicesState = [
      {
        arn: 'arn:cluster/foo',
        services: [
          {
            arn: 'arn:service/bar',
            desired: 0,
            scalableTargets: [],
          },
        ],
      },
    ];
    const conserveListr = await instance.conserve(task, stateObject, {
      dryRun: false,
    });
    conserveListr.setRenderer('silent');
    await conserveListr.run({});

    expect(updateServiceSpy).not.toBeCalled();

    AWSMock.restore('ECS');
  });

  it('skips conserve if dry-run option is enabled', async () => {
    AWSMock.setSDKInstance(AWS);

    const updateServiceSpy = jest.fn();
    AWSMock.mock('ECS', 'updateService', updateServiceSpy);

    const instance = new StopFargateEcsServicesTrick();
    const stateObject: StopFargateEcsServicesState = [
      {
        arn: 'arn:cluster/foo',
        services: [
          {
            arn: 'arn:service/bar',
            desired: 3,
            scalableTargets: [
              {
                namespace: 'ecs',
                resourceId: 'service/foor/bar',
                scalableDimension: 'ecs:service:DesiredCount',
                min: 1,
                max: 10,
              },
            ],
          },
        ],
      },
    ];

    const conserveListr = await instance.conserve(task, stateObject, {
      dryRun: true,
    });
    conserveListr.setRenderer('silent');
    await conserveListr.run({});

    expect(updateServiceSpy).not.toBeCalled();

    AWSMock.restore('ECS');
  });

  it('restores stopped ecs fargate service', async () => {
    AWSMock.setSDKInstance(AWS);

    const updateServiceSpy = jest
      .fn()
      .mockImplementation((params, callback) => {
        callback(null, {});
      });
    AWSMock.mock('ECS', 'updateService', updateServiceSpy);

    const registerScalableTargetSpy = jest
      .fn()
      .mockImplementation((params, callback) => {
        callback(null, {});
      });
    AWSMock.mock(
      'ApplicationAutoScaling',
      'registerScalableTarget',
      registerScalableTargetSpy,
    );

    const instance = new StopFargateEcsServicesTrick();
    const stateObject: StopFargateEcsServicesState = [
      {
        arn: 'arn:cluster/foo',
        services: [
          {
            arn: 'arn:service/bar',
            desired: 3,
            scalableTargets: [
              {
                namespace: 'ecs',
                resourceId: 'service/foor/bar',
                scalableDimension: 'ecs:service:DesiredCount',
                min: 1,
                max: 10,
              },
            ],
          },
        ],
      },
    ];
    const conserveListr = await instance.restore(task, stateObject, {
      dryRun: false,
    });
    conserveListr.setRenderer('silent');
    await conserveListr.run({});

    expect(updateServiceSpy).toBeCalledWith(
      expect.objectContaining({
        cluster: 'arn:cluster/foo',
        service: 'arn:service/bar',
        desiredCount: 3,
      }),
      expect.anything(),
    );

    expect(registerScalableTargetSpy).toBeCalledWith(
      expect.objectContaining({
        ServiceNamespace: 'ecs',
        ResourceId: 'service/foo/bar',
        ScalableDimension: 'ecs:service:DesiredCount',
        MinCapacity: 1,
        MaxCapacity: 10,
      }),
      expect.anything(),
    );

    AWSMock.restore('ECS');
    AWSMock.restore('ApplicationAutoScaling');
  });

  it('skips restore if original desired count was zero', async () => {
    AWSMock.setSDKInstance(AWS);

    const updateServiceSpy = jest.fn();
    AWSMock.mock('ECS', 'updateService', updateServiceSpy);

    const instance = new StopFargateEcsServicesTrick();
    const stateObject: StopFargateEcsServicesState = [
      {
        arn: 'arn:cluster/foo',
        services: [
          {
            arn: 'arn:service/bar',
            desired: 0,
            scalableTargets: [],
          },
        ],
      },
    ];

    const restoreListr = await instance.restore(task, stateObject, {
      dryRun: false,
    });
    restoreListr.setRenderer('silent');
    await restoreListr.run({});

    expect(updateServiceSpy).not.toBeCalled();

    AWSMock.restore('ECS');
  });

  it('skips restore if dry-run option is enabled', async () => {
    AWSMock.setSDKInstance(AWS);

    const updateServiceSpy = jest.fn();
    AWSMock.mock('ECS', 'updateService', updateServiceSpy);
    const registerScalableTargetSpy = jest.fn();
    AWSMock.mock(
      'ApplicationAutoScaling',
      'registerScalableTarget',
      registerScalableTargetSpy,
    );
    const instance = new StopFargateEcsServicesTrick();
    const stateObject: StopFargateEcsServicesState = [
      {
        arn: 'arn:cluster/foo',
        services: [
          {
            arn: 'arn:service/bar',
            desired: 3,
            scalableTargets: [
              {
                namespace: 'ecs',
                resourceId: 'service/foor/bar',
                scalableDimension: 'ecs:service:DesiredCount',
                min: 1,
                max: 10,
              },
            ],
          },
        ],
      },
    ];

    const restoreListr = await instance.restore(task, stateObject, {
      dryRun: true,
    });
    restoreListr.setRenderer('silent');
    await restoreListr.run({});

    expect(updateServiceSpy).not.toBeCalled();
    expect(registerScalableTargetSpy).not.toBeCalled();

    AWSMock.restore('ECS');
  });
});
