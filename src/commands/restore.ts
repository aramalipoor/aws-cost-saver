import { Command, flags } from '@oclif/command';

export default class Restore extends Command {
  static description =
    'To restore AWS resources stopped by the conserve command.';

  static flags = {
    'state-file': flags.string({
      char: 's',
      default: 'aws-cost-saver.json',
      description:
        'Path to state-file which contains original state of AWS resources to restore to.',
    }),
  };

  static args = [{ name: 'file' }];

  async run() {
    const { flags } = this.parse(Restore);

    // TODO flags['tag'] flags['state-file']
    this.log(`Restored, state-file = ${flags['state-file']}`);
  }
}
