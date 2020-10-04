import AWS from 'aws-sdk';
import {
  TagFilterList,
  TagFilter,
} from 'aws-sdk/clients/resourcegroupstaggingapi';

export const configureAWS = async (
  profile: string,
  region: string,
): Promise<AWS.Config> => {
  const credentials = await new AWS.CredentialProviderChain([
    () => new AWS.EnvironmentCredentials('AWS'),
    () =>
      new AWS.SharedIniFileCredentials({
        profile,
      }),
  ]).resolvePromise();

  AWS.config.update({
    region,
    credentials,
  });

  return AWS.config;
};

export const transformTagsFlagToFilterList = (tags: string[]): TagFilterList =>
  tags
    .map(t => t.split('=', 2))
    .map(([key, val]): TagFilter => ({ Key: key, Values: val ? [val] : [] }));
