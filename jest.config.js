const config = {
  roots: ['<rootDir>'],
  testMatch: ['test/**/*.+(ts|js)', '**/?(*.)+(spec|test).+(ts|js)'],
  transform: {
    '^.+\\.(ts)$': 'ts-jest',
  },
  collectCoverage: true,
  globals: {
    'ts-jest': {
      tsConfig: 'test/tsconfig.json',
    },
  },
};

module.exports = config;
