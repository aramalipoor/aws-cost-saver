import { Command, flags } from '@oclif/command';

export default class Conserve extends Command {
  static description =
    'This command uses various tricks to conserve as much money as possible. To restore, this command will create a `aws-cost-saver-state.json` file to be use by "restore"';

  static examples = [
    `$ aws-cost-saver conserve`,
    `$ aws-cost-saver conserve --tag Team=Tacos`,
    `$ aws-cost-saver conserve --state-file new-path.json`,
  ];

  static flags = {
    help: flags.help({ char: 'h' }),
    tag: flags.string({
      char: 't',
      multiple: true,
      description: 'Only conserve money for AWS resources with these tags.',
    }),
    'state-file': flags.string({
      char: 's',
      default: 'aws-cost-saver.json',
      description:
        'Where to keep original state of stopped resources to restore later.',
    }),
  };

  static args = [];

  async run() {
    const { flags } = this.parse(Conserve);

    // TODO flags['tag'] flags['state-file']

    this.log(
      `Conserved, tags = ${JSON.stringify(flags.tag)} state-file = ${
        flags['state-file']
      }`,
    );
  }
}
