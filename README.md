aws-cost-saver
=======================
[![CircleCI](https://circleci.com/gh/aramalipoor/aws-cost-saver.svg?style=svg)](https://circleci.com/gh/aramalipoor/aws-cost-saver)
[![codecov](https://codecov.io/gh/aramalipoor/aws-cost-saver/branch/master/graph/badge.svg)](https://codecov.io/gh/aramalipoor/aws-cost-saver)

A tiny CLI tool to help save costs in development environments when you're asleep and don't need them!

* [Usage](#usage)
* [Tricks](#tricks)
  1. [shutdown-ec2-instances](#-shutdown-ec2-instances)
  2. [stop-fargate-ecs-services](#-stop-fargate-ecs-services)
  3. [stop-rds-database-instances](#-stop-rds-database-instances)
  4. [decrease-dynamodb-provisioned-rcu-wcu](#-decrease-dynamodb-provisioned-rcu-wcu)
  5. [remove-nat-gateways](#-remove-nat-gateways)
  6. [snapshot-and-remove-elasticache-clusters](#-snapshot-and-remove-elasticache-clusters)
  7. [decrease-kinesis-streams-shards](#-decrease-kinesis-streams-shards)
  8. [stop-rds-database-clusters](#-stop-rds-database-clusters)
  9. [scaledown-auto-scaling-groups](#-scaledown-auto-scaling-groups)
  10. [suspend-auto-scaling-groups](#-suspend-auto-scaling-groups)

### Disclaimer
This utility is meant for **development** environments only where stopping and removing resources is not risky.

# Usage
```bash
# Install
$ npm install -g aws-cost-saver

# Try
$ aws-cost-saver conserve --help
$ aws-cost-saver conserve --dry-run --no-state-file
$ aws-cost-saver conserve --dry-run --no-state-file --only-summary

# Use
$ aws-cost-saver conserve
$ aws-cost-saver restore
```
## Commands
Under the hood [aws-sdk](https://github.com/aws/aws-sdk-js) is used, therefore AWS Credentials are read in this order:
1. From `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` and `AWS_REGION` environment variables.
2. From shared ini file (i.e. `~/.aws/credentials`)

### Conserve

This command uses [various tricks](#tricks) to conserve as much money as possible. To be able to [restore](#restore), this command will create a `state-file`.

```
USAGE
  $ aws-cost-saver conserve [-d|--dry-run] [-s|--state-file aws-cost-saver.json] ...

OPTIONS
  -d, --dry-run                          Only print actions and write state-file of current resources.
  -n, --no-state-file                    Ignore saving current state, useful when want to only conserve as much money as possible.
  -s, --state-file state-file.json       [default: aws-cost-saver.json] Where to keep original state of stopped/decreased resources to restore later.
  -u, --use-trick trick-machine-name     Enables an individual trick. Useful for tricks that are disabled by default. Can be used multiple times.
  -i, --ignore-trick trick-machine-name  Disables an individual trick. Useful when you do not like to use a specific trick. Can be used multiple times.
  --no-default-tricks                    Disables all default tricks. Useful alongside --use-trick to enable only specific set of tricks.
  -r, --region eu-central-1              [default: eu-central-1] AWS Region to converse resources in.
  -p, --profile my-aws-profile           [default: default] AWS Profile to use from ~/.aws/config
  -m, --only-summary                     Do not render live progress. Only print final summary in a clean format.
  -h, --help                             Show CLI help
```

<p align="center">
  <img width="460" src="./assets/example-screenshot.png" />
</p>

### Restore

To restore AWS resources stopped or removed by the [conserve](#conserve) command.

```
USAGE
  $ aws-cost-saver restore [-d|--dry-run] [-s|--state-file aws-cost-saver.json] ...

OPTIONS
  -d, --dry-run          Only list actions and do not actually execute them.
  -s, --state-file       [default: aws-cost-saver.json] Path to load previous state of your AWS resources from.
  -r, --region           [default: eu-central-1] AWS region to restore resoruces in.
  -p, --profile          [default: default] AWS profile to lookup from ~/.aws/config
  -m, --only-summary     Do not render live progress. Only print final summary in a clean format.
  -h, --help             Show CLI help.
```

# Tricks
Here is a list of tricks aws-cost-saver uses to reduce AWS costs when you don't need them.

### # shutdown-ec2-instances
Stopping running EC2 instances will save compute-hour. This trick will keep track of stopped EC2 instances in the state-file and start them again on restore.

### # stop-fargate-ecs-services
Stopping AWS Fargate ECS services (i.e. tasks) will save compute-hour. This trick will keep track of stopped Fargate ECS services in the state-file and start them again on restore.

### # stop-rds-database-instances
Stopping RDS databases will save underlying EC2 instance costs. This trick will keep track of stopped databases in the state-file and start them again on restore.

### # decrease-dynamodb-provisioned-rcu-wcu
Provisioned RCU and WCU on DynamoDB tables costs hourly. This trick will decrease them to minimum value (i.e. 1). Original values will be stored in state-file to be restored later.

### # remove-nat-gateways
NAT Gateways are charged hourly. This trick will remove NAT Gateways while you don't use your services, and creates them again on "restore" command.

* Removing NAT Gateways stops instances access to internet.
* This trick is currently **disabled by default** because removing/recreating NAT gateway will change the ID therefore IaC such as terraform will be confused. Use `--use-trick` flag to explicitly enable it:
```sh
$ aws-cost-saver conserve --use-trick remove-nat-gateways
```

### # snapshot-and-remove-elasticache-clusters
ElastiCache clusters cost hourly but unfortunately it's not possible to stop them like an EC2 instance. To save costs this trick will take a snapshot of current cluster (preserving data, config and cluster ID) and delete it. To restore it'll create a new cluster based on snapshot taken. 

* Due to AWS limitation, backup and restore is supported only for clusters running on Redis.
* This trick is currently **disabled by default** to be tested by early users. Use `--use-trick` flag to explicitly enable it:
```sh
$ aws-cost-saver conserve --use-trick snapshot-remove-elasticache-redis
```

### # decrease-kinesis-streams-shards
Kinesis Stream Shards cost hourly. This trick will decrease open shards to the minimum of 1, in multiple steps by [halving number of shards](https://docs.aws.amazon.com/kinesis/latest/APIReference/API_UpdateShardCount.html#Streams-UpdateShardCount-request-TargetShardCount) in each step. Currently this trick is useful when you're doing `UNIFORM_SCALING`, i.e. default config of Kinesis Stream. 

### # stop-rds-database-clusters
Stopping RDS clusters will save underlying EC2 instance costs. This trick will keep track of stopped clusters in the state-file and start them again on restore.

### # scaledown-auto-scaling-groups
When Auto Scaling Groups are configured they might launch EC2 instances. This trick will set "desired", "min" and "max" capacity of ASGs to zero and keep track of original values in the state-file. Scaling-down an ASG will terminate all instances therefore temporary volumes will be lost.

* This trick is currently **disabled by default**. Use `--use-trick` flag to explicitly enable it:
```sh
$ aws-cost-saver conserve --use-trick scaledown-auto-scaling-groups
```

### # suspend-auto-scaling-groups
When Auto Scaling Groups processes are active they might launch EC2 instances. This trick will suspend all processes of ASGs to prevent launching new instances.

### # TODO
If you know any other tricks to save some money feel free to create a Pull Request or raise an issue.

# Alternatives
There are various ways to save money on AWS that need per-case judgement and it'll be hard to generalize into aws-cost-saver, but here is a list of useful resources:
* [Google Search: "aws cost saving"](https://lmgtfy.com/?q=aws+cost+saving)
* [Use Amazon EC2 Spot Instances to reduce EC2 costs for background and non-critical services](https://www.youtube.com/watch?v=7q5AeoKsGJw)
* [Delete idle LBs, Use private subnets, Use auto-scalers, etc.](https://medium.com/@george_51059/reduce-aws-costs-74ef79f4f348)

# License
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)  

AWS Cost Saver is licensed under MIT License. See [LICENSE](LICENSE) for the full license text.
