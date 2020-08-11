import { expect, test } from '@oclif/test';

describe('restore', () => {
  test
    .stdout()
    .command(['restore'])
    .it('runs restore', ctx => {
      expect(ctx.stdout).to.contain('Restored');
    });

  test
    .stdout()
    .command(['restore', '--state-file', 'test.json'])
    .it('runs restore test.json', ctx => {
      expect(ctx.stdout).to.contain('Restored');
    });
});
