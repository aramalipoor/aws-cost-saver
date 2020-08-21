aws-cost-saver
=======================

A tiny CLI tool to help save costs in development environments when you're sleep and don't need them!

**Disclaimer**: This utility is meant for **development** environments only where stopping and removing resources is not risky.

* [Usage](#usage)
* [Tricks](#tricks)
  * [shutdown-ec2-instances](#-shutdown-ec2-instances)
  * [stop-fargate-ecs-services](#-stop-fargate-ecs-services)
  * [remove-nat-gateways](#-remove-nat-gateways)
  * [stop-rds-databases](#-stop-rds-databases)

# Usage
```sh-session
$ npm install -g aws-cost-saver
```
## Commands
Under the hood [aws-sdk](https://github.com/aws/aws-sdk-js) is used, therefore AWS Credentials are read in this order:
1. From `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` and `AWS_REGION` environment variables.
2. From shared ini file (i.e. `~/.aws/credentials`)

### Conserve

This command uses [various tricks](#tricks) to conserve as much money as possible. To be able to [restore](#restore), this command will create a `state-file`.

```
USAGE
  $ aws-cost-saver conserve [-d|--dry-run] [-s|--state-file aws-cost-saver.json] [-r|--region eu-central-1] [-p|--profile default]

OPTIONS
  -h, --help             Show CLI help.
  -d, --dry-run          Only list actions and do not actually execute them.
  -s, --state-file       (default: aws-cost-saver.json) Path to save current state of your AWS resources.
  -r, --region           (default: eu-central-1) AWS region to look up and save resoruces.
  -p, --profile          (default: default) AWS profile to lookup from ~/.aws/config
```

![Example Screenshot](./assets/example-screenshot.png "conserve")

### Restore

To restore AWS resources stopped or removed by the [conserve](#conserve) command.

```
USAGE
  $ aws-cost-saver restore [-d|--dry-run] [-s|--state-file aws-cost-saver.json] [-r|--region eu-central-1] [-p|--profile default]

OPTIONS
  -h, --help             Show CLI help.
  -d, --dry-run          Only list actions and do not actually execute them.
  -s, --state-file       (default: aws-cost-saver.json) Path to load previous state of your AWS resources from.
  -r, --region           (default: eu-central-1) AWS region to restore resoruces in.
  -p, --profile          (default: default) AWS profile to lookup from ~/.aws/config
```

# Tricks
Here is a list of tricks aws-cost-saver uses to reduce AWS costs when you don't need them.

### # shutdown-ec2-instances
Stopping running EC2 instances will save compute-hour. This trick will keep track of stopped EC2 instances in the state-file and start them again on restore.

### # stop-fargate-ecs-services
Stopping AWS Fargate ECS services (i.e. tasks) will save compute-hour. This trick will keep track of stopped Fargate ECS services in the state-file and start them again on restore.

### # stop-rds-databases
Stopping RDS databases will save underlying EC2 instance costs. This trick will keep track of stopped databases in the state-file and start them again on restore.
