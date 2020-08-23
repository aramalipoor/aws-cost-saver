import AWS from 'aws-sdk';

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
