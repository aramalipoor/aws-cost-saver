import AWS from 'aws-sdk';
import AWSMock from 'aws-sdk-mock';
import { mockProcessStdout } from 'jest-mock-process';
import { ListrTaskWrapper } from 'listr2';
import nock from 'nock';

import {
  RemoveNatGatewaysTrick,
  RemoveNatGatewaysState,
} from '../../src/tricks/remove-nat-gateways.trick';
import { TrickContext } from '../../src/types/trick-context';
import { NatGatewayState } from '../../src/states/nat-gateway.state';
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

describe('remove-nat-gateways', () => {
  let task: ListrTaskWrapper<any, any>;

  beforeEach(() => {
    task = createMockTask();
  });

  it('returns correct machine name', async () => {
    const instance = new RemoveNatGatewaysTrick();
    expect(instance.getMachineName()).toBe(RemoveNatGatewaysTrick.machineName);
  });

  it('skips preparing tags', async () => {
    const instance = new RemoveNatGatewaysTrick();
    await instance.prepareTags(task, {} as TrickContext, {
      dryRun: false,
    });
    expect(task.skip).toBeCalled();
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
            {
              NatGatewayId: 'foo',
              VpcId: 'bar',
              SubnetId: 'baz',
              // NatGatewayAddresses: [{ AllocationId: 'qux' }],
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
          RouteTables: [],
        } as AWS.EC2.Types.DescribeRouteTablesResult);
      },
    );

    const instance = new RemoveNatGatewaysTrick();
    const stateObject: RemoveNatGatewaysState = [];
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
          expect.objectContaining({
            message: expect.stringMatching(/unexpected/gi),
          }),
          expect.objectContaining({
            message: expect.stringMatching(/unexpected/gi),
          }),
          expect.objectContaining({
            message: expect.stringMatching(/unexpected/gi),
          }),
        ],
      }),
    ]);

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
            {
              NatGatewayId: 'foosec',
              VpcId: 'barex',
              SubnetId: 'baza',
              NatGatewayAddresses: [{ AllocationId: 'quxoo' }],
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
                { DestinationCidrBlock: '1.1.0.0/0', NatGatewayId: 'foosec' },
              ],
            },
            {
              RouteTableId: 'quux',
              Routes: [
                { DestinationCidrBlock: '2.2.0.0/0', NatGatewayId: 'foo' },
              ],
            },
            {
              RouteTableId: 'cypo',
              Routes: [
                {
                  DestinationIpv6CidrBlock: '2001:db8::/32',
                  NatGatewayId: 'foo',
                },
              ],
            },
            {
              RouteTableId: 'lopr',
              Routes: [
                {
                  DestinationPrefixListId: 'some-id',
                  NatGatewayId: 'foo',
                },
              ],
            },
            {
              RouteTableId: 'mayba',
              Routes: [],
            },
          ],
        } as AWS.EC2.Types.DescribeRouteTablesResult);
      },
    );

    const instance = new RemoveNatGatewaysTrick();
    const stateObject: RemoveNatGatewaysState = [];
    const listr = await instance.getCurrentState(
      task,
      { resourceTagMappings: [] } as TrickContext,
      stateObject,
      {
        dryRun: false,
      },
    );

    await listr.run({});

    expect(stateObject.pop()).toMatchObject({
      id: 'foosec',
      vpcId: 'barex',
      subnetId: 'baza',
      allocationIds: ['quxoo'],
      state: 'available',
      routes: [{ routeTableId: 'quuz', destinationCidr: '1.1.0.0/0' }],
      tags: [{ Key: 'Team', Value: 'Tacos' }],
    } as NatGatewayState);

    expect(stateObject.pop()).toMatchObject({
      id: 'foo',
      vpcId: 'bar',
      subnetId: 'baz',
      allocationIds: ['qux'],
      state: 'available',
      routes: [
        { routeTableId: 'quux', destinationCidr: '2.2.0.0/0' },
        { routeTableId: 'cypo', destinationIpv6Cidr: '2001:db8::/32' },
        { routeTableId: 'lopr', destinationPrefixListId: 'some-id' },
      ],
      tags: [{ Key: 'Team', Value: 'Tacos' }],
    } as NatGatewayState);

    AWSMock.restore('EC2');
  });

  it('generates state object for tagged resources', async () => {
    AWSMock.setSDKInstance(AWS);

    const describeNatGatewaysSpy = jest
      .fn()
      .mockImplementationOnce(
        (
          params: AWS.EC2.Types.DescribeNatGatewaysRequest,
          callback: Function,
        ) => {
          callback(null, {
            NatGateways: [
              {
                NatGatewayId: 'foosec',
                VpcId: 'barex',
                SubnetId: 'baza',
                NatGatewayAddresses: [{ AllocationId: 'quxoo' }],
                State: 'available',
                Tags: [{ Key: 'Team', Value: 'Chimichanga' }],
              },
            ],
          } as AWS.EC2.Types.DescribeNatGatewaysResult);
        },
      );
    AWSMock.mock('EC2', 'describeNatGateways', describeNatGatewaysSpy);

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
                { DestinationCidrBlock: '1.1.0.0/0', NatGatewayId: 'foosec' },
              ],
            },
            {
              RouteTableId: 'quux',
              Routes: [
                { DestinationCidrBlock: '2.2.0.0/0', NatGatewayId: 'foo' },
              ],
            },
            {
              RouteTableId: 'cypo',
              Routes: [
                {
                  DestinationIpv6CidrBlock: '2001:db8::/32',
                  NatGatewayId: 'foo',
                },
              ],
            },
            {
              RouteTableId: 'lopr',
              Routes: [
                {
                  DestinationPrefixListId: 'some-id',
                  NatGatewayId: 'foo',
                },
              ],
            },
            {
              RouteTableId: 'mayba',
              Routes: [],
            },
          ],
        } as AWS.EC2.Types.DescribeRouteTablesResult);
      },
    );

    const instance = new RemoveNatGatewaysTrick();
    const stateObject: RemoveNatGatewaysState = [];
    const listr = await instance.getCurrentState(
      task,
      { resourceTagMappings: [] } as TrickContext,
      stateObject,
      {
        dryRun: false,
        tags: [{ Key: 'Team', Values: ['Chimichanga'] }],
      },
    );

    await listr.run({});

    expect(describeNatGatewaysSpy).toBeCalledWith(
      expect.objectContaining({
        Filter: [{ Name: 'tag:Team', Values: ['Chimichanga'] }],
        MaxResults: 10,
      } as AWS.EC2.Types.DescribeNatGatewaysRequest),
      expect.any(Function),
    );
    expect(stateObject.length).toBe(1);
    expect(stateObject.pop()).toMatchObject({
      id: 'foosec',
      vpcId: 'barex',
      subnetId: 'baza',
      allocationIds: ['quxoo'],
      state: 'available',
      routes: [{ routeTableId: 'quuz', destinationCidr: '1.1.0.0/0' }],
      tags: [{ Key: 'Team', Value: 'Chimichanga' }],
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
    const replaceRouteSpy = jest.fn().mockImplementation((params, callback) => {
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
        routes: [
          { routeTableId: 'quux', destinationCidr: '1.2.0.0/0' },
          { routeTableId: 'cypo', destinationIpv6Cidr: '2001:db8::/32' },
          { routeTableId: 'lopr', destinationPrefixListId: 'some-id' },
        ],
        tags: [{ Key: 'Team', Value: 'Tacos' }],
      },
    ];
    const restoreListr = await instance.restore(task, stateObject, {
      dryRun: false,
    });

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
    expect(replaceRouteSpy).toBeCalledWith(
      expect.objectContaining({
        RouteTableId: 'cypo',
        NatGatewayId: 'newfoo',
        DestinationIpv6CidrBlock: '2001:db8::/32',
      }),
      expect.anything(),
    );
    expect(replaceRouteSpy).toBeCalledWith(
      expect.objectContaining({
        RouteTableId: 'lopr',
        NatGatewayId: 'newfoo',
        DestinationPrefixListId: 'some-id',
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

    await restoreListr.run({});

    expect(createNatGatewaySpy).not.toBeCalled();

    AWSMock.restore('EC2');
  });
});
