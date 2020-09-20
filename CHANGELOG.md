# [v0.1.0](https://github.com/aramalipoor/aws-cost-saver/releases/tag/v0.1.0) (2020-09-20)
* Add `-w | --overwrite-state-file` flag ([#30](https://github.com/aramalipoor/aws-cost-saver/pull/30))

## [v0.0.13](https://github.com/aramalipoor/aws-cost-saver/compare/v0.0.12...v0.0.13) (2020-09-06)
* Add S3 storage for state file ([#27](https://github.com/aramalipoor/aws-cost-saver/pull/27))

## [v0.0.12](https://github.com/aramalipoor/aws-cost-saver/compare/v0.0.11...v0.0.12) (2020-09-05)
* Collapse when actions finish to keep clutter to minimum during operations ([#26](https://github.com/aramalipoor/aws-cost-saver/pull/26))
* Introduce -m|--only-summary flag to print a clean summary of actions ([#26](https://github.com/aramalipoor/aws-cost-saver/pull/26))
* Use listr2 instead of listr npm package for per-task options ([#26](https://github.com/aramalipoor/aws-cost-saver/pull/26))

## [v0.0.11](https://github.com/aramalipoor/aws-cost-saver/compare/v0.0.10...v0.0.11) (2020-08-31)
* Add suspend-auto-scaling-groups trick ([#24](https://github.com/aramalipoor/aws-cost-saver/pull/24))
* Disable scaledown-auto-scaling-groups trick by default ([#24](https://github.com/aramalipoor/aws-cost-saver/pull/24))

## [v0.0.10](https://github.com/aramalipoor/aws-cost-saver/compare/v0.0.9...v0.0.10) (2020-08-30)
* Disable incremental compilation

## [v0.0.9](https://github.com/aramalipoor/aws-cost-saver/compare/v0.0.8...v0.0.9) (2020-08-30)
* Add scaledown-auto-scaling-groups trick ([#23](https://github.com/aramalipoor/aws-cost-saver/pull/23))
* Add stop-rds-database-clusters trick ([#22](https://github.com/aramalipoor/aws-cost-saver/pull/22))
* Restore NAT Gateway routes on restore command ([#20](https://github.com/aramalipoor/aws-cost-saver/pull/20))
* Added unit tests with 100% coverage ([#20](https://github.com/aramalipoor/aws-cost-saver/pull/20))
* Refactor the code to be more testable ([#17](https://github.com/aramalipoor/aws-cost-saver/pull/17))

## [v0.0.8](https://github.com/aramalipoor/aws-cost-saver/compare/v0.0.7...v0.0.8) (2020-08-23)
* Add decrease-kinesis-streams-shards trick ([#13](https://github.com/aramalipoor/aws-cost-saver/pull/13))

## [v0.0.7](https://github.com/aramalipoor/aws-cost-saver/compare/v0.0.6...v0.0.7) (2020-08-23)
* Fix tsc, npm pack and publish issues

## [v0.0.6](https://github.com/aramalipoor/aws-cost-saver/compare/v0.0.5...v0.0.6) (2020-08-23)
* Add snapshot-and-remove-elasti-cache-clusters trick ([#12](https://github.com/aramalipoor/aws-cost-saver/pull/12))
* Allow enabling and disabling tricks using `--use-trick` and `--ignore-trick` ([#11](https://github.com/aramalipoor/aws-cost-saver/pull/11))
* Allow concurrency for some tricks ([#11](https://github.com/aramalipoor/aws-cost-saver/pull/11))

## [v0.0.5](https://github.com/aramalipoor/aws-cost-saver/compare/v0.0.4...v0.0.5) (2020-08-23)
* Add decrease-dynamodb-provisioned-rcu-wcu trick ([#9](https://github.com/aramalipoor/aws-cost-saver/pull/9))
* Add `-n|--no-state-file` flag to ignore writing to a state file ([#9](https://github.com/aramalipoor/aws-cost-saver/pull/9))

## [v0.0.4](https://github.com/aramalipoor/aws-cost-saver/compare/v0.0.1...v0.0.4) (2020-08-22)
* Add shutdown-ec2-instances trick
* Add stop-fargate-ecs-services trick
* Add stop-rds-database-instances trick
* Use listr for better visualization

## [v0.0.1](https://github.com/aramalipoor/aws-cost-saver/releases/tag/v0.0.1) (2020-08-11)

### Initial release

* aws-cost-saver v0.0.0: Reverse NPM module name aws-cost-saver
