const config = {
  roots: ['<rootDir>'],
  testMatch: ['test/**/*.+(ts|js)', '**/?(*.)+(spec|test).+(ts|js)'],
  transform: {
    '^.+\\.(ts)$': 'ts-jest',
  },
};

module.exports = config;
