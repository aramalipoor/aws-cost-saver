const config = {
  roots: ['<rootDir>'],
  testMatch: ['test/**/*.+(ts|js)', '**/?(*.)+(spec|test).+(ts|js)'],
  transform: {
    '^.+\\.(ts)$': 'ts-jest',
  },
  collectCoverage: true,
};

module.exports = config;
