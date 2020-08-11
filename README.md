aws-cost-saver (work-in-progress)
=======================

A tiny CLI tool to help save costs in development environments when you're sleep and don't need them!

<!-- toc -->
* [Usage](#usage)
* [Tricks](#tricks)
  * [remove-ec2-eips](#-remove-ec2-eips)
  * [shutdown-ec2-instances](#-shutdown-ec2-instances)
  * [stop-fargate-ecs-tasks](#-stop-fargate-ecs-tasks)
  * [stop-rds-databases](#-stop-rds-databases)
<!-- tocstop -->

# Usage
<!-- usage -->
```sh-session
$ npm install -g aws-cost-saver
```
<!-- usagestop -->
## Commands
Under the hood [aws-sdk](https://github.com/aws/aws-sdk-js) is used, therefore AWS Credentials are read from `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` environment variables.

<!-- commands -->
* [`aws-cost-saver conserve [-t|--tag Key=Value] [-s|--state-file aws-cost-saver-state.json]`](#conserve)
* [`aws-cost-saver restore [-s|--state-file aws-cost-saver-state.json]`](#restore)

### Conserve

This command uses [various tricks](#tricks) to conserve as much money as possible. To be able to [restore](#restore), this command will create a `state-file`.

```
USAGE
  $ aws-cost-saver conserve [-t|--tag Key=Value] [-s|--state-file aws-cost-saver-state.json]

OPTIONS
  -h, --help             show CLI help
  -t, --tag Team=Tacos   filter to resources matching this tag only
```

### Restore

To restore AWS resources stopped by the [conserve](#conserve) command

```
USAGE
  $ aws-cost-saver restore [-s|--state-file aws-cost-saver-state.json]

OPTIONS
  -h, --help       show CLI help
```
<!-- commandsstop -->

## state-file
aws-cost-saver uses a state-file to keep track of actions performed to save costs so it can be used by [restore](#restore) command. 

# Tricks
Here is a list of tricks aws-cost-saver uses to reduce AWS costs when you don't need them.

### # remove-ec2-eips
Each EIP costs money so we can detach and remove them from EC2 instances when not needed. This trick will keep track of removed EIP addresses in the state-file and add them back on restore.

### # shutdown-ec2-instances
Stopping running EC2 instances will save compute-hour. This trick will keep track of stopped EC2 instances in the state-file and start them again on restore.

### # stop-fargate-ecs-tasks
Stopping AWS Fargate ECS tasks will save compute-hour. This trick will keep track of stopped Fargate ECS tasks in the state-file and start them again on restore.

### # stop-rds-databases
Stopping RDS databases will save underlying EC2 instance costs. This trick will keep track of stopped databases in the state-file and start them again on restore.
