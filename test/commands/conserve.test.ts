import { expect, test } from '@oclif/test';

describe('conserve', () => {
  test
    .stdout()
    .command(['conserve'])
    .it('runs conserve', ctx => {
      expect(ctx.stdout).to.contain('Conserved');
    });

  test
    .stdout()
    .command(['conserve', '--state-file', 'test.json'])
    .it('runs conserve test.json', ctx => {
      expect(ctx.stdout).to.contain('Conserved');
    });
});
