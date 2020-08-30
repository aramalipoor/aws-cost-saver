import AWS from 'aws-sdk';
import AWSMock from 'aws-sdk-mock';

import { ListrTaskWrapper } from 'listr';

import {
  RemoveNatGatewaysTrick,
  RemoveNatGatewaysState,
} from '../../src/tricks/remove-nat-gateways.trick';
import { NatGatewayState } from '../../src/states/nat-gateway.state';

beforeAll(async done => {
  // AWSMock cannot mock waiters at the moment
  AWS.EC2.prototype.waitFor = jest.fn().mockImplementation(() => ({
    promise: jest.fn(),
  }));

  done();
});

describe('remove-nat-gateways', () => {
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
    const instance = new RemoveNatGatewaysTrick();
    expect(instance.getMachineName()).toBe(RemoveNatGatewaysTrick.machineName);
  });

  it('returns different title for conserve and restore commands', async () => {
    const instance = new RemoveNatGatewaysTrick();
    expect(instance.getConserveTitle()).not.toBe(instance.getRestoreTitle());
  });

  it('returns an empty Listr if no NAT gateway is found', async () => {
    AWSMock.setSDKInstance(AWS);

    AWSMock.mock(
      'EC2',
      'describeNatGateways',
      (
        params: AWS.EC2.Types.DescribeNatGatewaysRequest,
        callback: Function,
      ) => {
        callback(null, {
          NatGateways: [],
        } as AWS.EC2.Types.DescribeNatGatewaysResult);
      },
    );

    const instance = new RemoveNatGatewaysTrick();
    const stateObject: RemoveNatGatewaysState = [];
    const listr = await instance.getCurrentState(task, stateObject, {
      dryRun: false,
    });

    expect(listr.tasks.length).toBe(0);

    AWSMock.restore('EC2');
  });

  it('errors if required fields were not returned by AWS', async () => {
    AWSMock.setSDKInstance(AWS);

    AWSMock.mock(
      'EC2',
      'describeNatGateways',
      (
        params: AWS.EC2.Types.DescribeNatGatewaysRequest,
        callback: Function,
      ) => {
        callback(null, {
          NatGateways: [
            {
              // NatGatewayId: 'foo',
              VpcId: 'bar',
              SubnetId: 'baz',
              NatGatewayAddresses: [{ AllocationId: 'qux' }],
              Tags: [{ Key: 'Team', Value: 'Tacos' }],
            },
            {
              NatGatewayId: 'foo',
              // VpcId: 'bar',
              SubnetId: 'baz',
              NatGatewayAddresses: [{ AllocationId: 'qux' }],
              Tags: [{ Key: 'Team', Value: 'Tacos' }],
            },
            {
              NatGatewayId: 'foo',
              VpcId: 'bar',
              // SubnetId: 'baz',
              NatGatewayAddresses: [{ AllocationId: 'qux' }],
              Tags: [{ Key: 'Team', Value: 'Tacos' }],
            },
          ],
        } as AWS.EC2.Types.DescribeNatGatewaysResult);
      },
    );

    const instance = new RemoveNatGatewaysTrick();
    const stateObject: RemoveNatGatewaysState = [];
    const listr = await instance.getCurrentState(task, stateObject, {
      dryRun: false,
    });
    listr.setRenderer('silent');

    await expect(async () => listr.run()).rejects.toMatchObject({
      errors: expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringMatching(/unexpected values/gi),
        }),
        expect.objectContaining({
          message: expect.stringMatching(/unexpected values/gi),
        }),
        expect.objectContaining({
          message: expect.stringMatching(/unexpected values/gi),
        }),
      ]),
    });

    AWSMock.restore('EC2');
  });

  it('generates state object for Nat gateways', async () => {
    AWSMock.setSDKInstance(AWS);

    AWSMock.mock(
      'EC2',
      'describeNatGateways',
      (
        params: AWS.EC2.Types.DescribeNatGatewaysRequest,
        callback: Function,
      ) => {
        callback(null, {
          NatGateways: [
            {
              NatGatewayId: 'foo',
              VpcId: 'bar',
              SubnetId: 'baz',
              NatGatewayAddresses: [{ AllocationId: 'qux' }],
              State: 'available',
              Tags: [{ Key: 'Team', Value: 'Tacos' }],
            },
          ],
        } as AWS.EC2.Types.DescribeNatGatewaysResult);
      },
    );
    AWSMock.mock(
      'EC2',
      'describeRouteTables',
      (
        params: AWS.EC2.Types.DescribeRouteTablesRequest,
        callback: Function,
      ) => {
        callback(null, {
          RouteTables: [
            {
              RouteTableId: 'quuz',
              Routes: [
                { DestinationCidrBlock: '1.1.0.0/0', NatGatewayId: 'barex' },
              ],
            },
            {
              RouteTableId: 'quux',
              Routes: [
                { DestinationCidrBlock: '2.2.0.0/0', NatGatewayId: 'foo' },
              ],
            },
          ],
        } as AWS.EC2.Types.DescribeRouteTablesResult);
      },
    );

    const instance = new RemoveNatGatewaysTrick();
    const stateObject: RemoveNatGatewaysState = [];
    const listr = await instance.getCurrentState(task, stateObject, {
      dryRun: false,
    });

    listr.setRenderer('silent');
    await listr.run({});

    expect(stateObject.pop()).toMatchObject({
      id: 'foo',
      vpcId: 'bar',
      subnetId: 'baz',
      allocationIds: ['qux'],
      state: 'available',
      routes: [{ routeTableId: 'quux', destinationCidr: '2.2.0.0/0' }],
      tags: [{ Key: 'Team', Value: 'Tacos' }],
    } as NatGatewayState);

    AWSMock.restore('EC2');
  });

  it('conserves NAT gateways', async () => {
    AWSMock.setSDKInstance(AWS);

    const deleteNatGatewaySpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback(null, {});
      });
    AWSMock.mock('EC2', 'deleteNatGateway', deleteNatGatewaySpy);

    const instance = new RemoveNatGatewaysTrick();
    const stateObject: RemoveNatGatewaysState = [
      {
        id: 'foo',
        vpcId: 'bar',
        subnetId: 'baz',
        state: 'available',
        allocationIds: ['qux'],
        routes: [{ routeTableId: 'quux', destinationCidr: '0.0.0.0/0' }],
        tags: [{ Key: 'Name', Value: 'my-gw' }],
      },
    ];
    const conserveListr = await instance.conserve(task, stateObject, {
      dryRun: false,
    });
    conserveListr.setRenderer('silent');
    await conserveListr.run({});

    expect(deleteNatGatewaySpy).toBeCalledWith(
      expect.objectContaining({
        NatGatewayId: 'foo',
      }),
      expect.anything(),
    );

    AWSMock.restore('EC2');
  });

  it('skips conserve if status is not "available"', async () => {
    AWSMock.setSDKInstance(AWS);

    const deleteNatGatewaySpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback(null, {});
      });
    AWSMock.mock('EC2', 'deleteNatGateway', deleteNatGatewaySpy);

    const instance = new RemoveNatGatewaysTrick();
    const stateObject: RemoveNatGatewaysState = [
      {
        id: 'foo',
        vpcId: 'bar',
        subnetId: 'baz',
        state: 'pending',
        allocationIds: ['qux'],
        routes: [{ routeTableId: 'quux', destinationCidr: '0.0.0.0/0' }],
        tags: [{ Key: 'Name', Value: 'my-gw' }],
      },
    ];

    const conserveListr = await instance.conserve(task, stateObject, {
      dryRun: false,
    });
    conserveListr.setRenderer('silent');
    await conserveListr.run({});

    expect(deleteNatGatewaySpy).not.toBeCalled();

    AWSMock.restore('EC2');
  });

  it('skips conserve if dry-run option is enabled', async () => {
    AWSMock.setSDKInstance(AWS);

    const deleteNatGatewaySpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback(null, {});
      });
    AWSMock.mock('EC2', 'deleteNatGateway', deleteNatGatewaySpy);

    const instance = new RemoveNatGatewaysTrick();
    const stateObject: RemoveNatGatewaysState = [
      {
        id: 'foo',
        vpcId: 'bar',
        subnetId: 'baz',
        allocationIds: ['qux'],
        state: 'available',
        routes: [{ routeTableId: 'quux', destinationCidr: '0.0.0.0/0' }],
        tags: [{ Key: 'Team', Value: 'Tacos' }],
      },
    ];

    const conserveListr = await instance.conserve(task, stateObject, {
      dryRun: true,
    });
    conserveListr.setRenderer('silent');
    await conserveListr.run({});

    expect(deleteNatGatewaySpy).not.toBeCalled();

    AWSMock.restore('EC2');
  });

  it('restores removed NAT gateway', async () => {
    AWSMock.setSDKInstance(AWS);

    const createNatGatewaySpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback(null, {
          NatGateway: {
            NatGatewayId: 'newfoo',
          },
        } as AWS.EC2.CreateNatGatewayResult);
      });
    AWSMock.mock('EC2', 'createNatGateway', createNatGatewaySpy);
    const replaceRouteSpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback(null, {});
      });
    AWSMock.mock('EC2', 'replaceRoute', replaceRouteSpy);

    const instance = new RemoveNatGatewaysTrick();
    const stateObject: RemoveNatGatewaysState = [
      {
        id: 'foo',
        vpcId: 'bar',
        subnetId: 'baz',
        allocationIds: ['qux'],
        state: 'available',
        routes: [{ routeTableId: 'quux', destinationCidr: '1.2.0.0/0' }],
        tags: [{ Key: 'Team', Value: 'Tacos' }],
      },
    ];
    const restoreListr = await instance.restore(task, stateObject, {
      dryRun: false,
    });
    restoreListr.setRenderer('silent');
    await restoreListr.run({});

    expect(createNatGatewaySpy).toBeCalledWith(
      expect.objectContaining({
        AllocationId: 'qux',
        SubnetId: 'baz',
        TagSpecifications: [
          {
            ResourceType: 'natgateway',
            Tags: [{ Key: 'Team', Value: 'Tacos' }],
          },
        ],
      }),
      expect.anything(),
    );
    expect(replaceRouteSpy).toBeCalledWith(
      expect.objectContaining({
        RouteTableId: 'quux',
        NatGatewayId: 'newfoo',
        DestinationCidrBlock: '1.2.0.0/0',
      }),
      expect.anything(),
    );

    AWSMock.restore('EC2');
  });

  it('skips restore if status was not "available"', async () => {
    AWSMock.setSDKInstance(AWS);

    const createNatGatewaySpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback(null, {});
      });
    AWSMock.mock('EC2', 'createNatGateway', createNatGatewaySpy);

    const instance = new RemoveNatGatewaysTrick();
    const stateObject: RemoveNatGatewaysState = [
      {
        id: 'foo',
        vpcId: 'bar',
        subnetId: 'baz',
        state: 'pending',
        allocationIds: ['qux'],
        routes: [{ routeTableId: 'quux', destinationCidr: '0.0.0.0/0' }],
        tags: [{ Key: 'Name', Value: 'my-gw' }],
      },
    ];

    const restoreListr = await instance.restore(task, stateObject, {
      dryRun: false,
    });
    restoreListr.setRenderer('silent');
    await restoreListr.run({});

    expect(createNatGatewaySpy).not.toBeCalled();

    AWSMock.restore('EC2');
  });

  it('skips restore if dry-run option is enabled', async () => {
    AWSMock.setSDKInstance(AWS);

    const createNatGatewaySpy = jest
      .fn()
      .mockImplementationOnce((params, callback) => {
        callback(null, {});
      });
    AWSMock.mock('EC2', 'createNatGateway', createNatGatewaySpy);

    const instance = new RemoveNatGatewaysTrick();
    const stateObject: RemoveNatGatewaysState = [
      {
        id: 'foo',
        vpcId: 'bar',
        subnetId: 'baz',
        allocationIds: ['qux'],
        state: 'available',
        routes: [{ routeTableId: 'quux', destinationCidr: '0.0.0.0/0' }],
        tags: [{ Key: 'Team', Value: 'Tacos' }],
      },
    ];

    const restoreListr = await instance.restore(task, stateObject, {
      dryRun: true,
    });
    restoreListr.setRenderer('silent');
    await restoreListr.run({});

    expect(createNatGatewaySpy).not.toBeCalled();

    AWSMock.restore('EC2');
  });
});
