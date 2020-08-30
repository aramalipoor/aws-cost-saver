import { configureAWS } from '../src/configure-aws';

jest.mock('fs');
import fs from 'fs';

beforeAll(() => {
  jest.spyOn(fs, 'readFileSync').mockImplementation((path: any) => {
    if (path.includes('.aws/credentials')) {
      return `
[default]
aws_access_key_id = xxxxxxxxxxxxxxxxxxxx
aws_secret_access_key = yyyyyyyyyyyyyyyyyyyyyyyyy

[aramium]
aws_access_key_id = aaaaaaaaaaaaaaa
aws_secret_access_key = bbbbbbbbbbbbbbbbbbbbb
`;
    }

    if (path.includes('.aws/config')) {
      return `
[default]
region = us-west-2

[aramium]
region = eu-east-1
`;
    }

    throw new Error(`Unexpected file path to read`);
  });
});

describe.only('configure-aws', () => {
  it('uses user-provided region', async () => {
    const config = await configureAWS('aramium', 'ap-northeast-1');

    expect(config.region).toBe('ap-northeast-1');
  });
});
