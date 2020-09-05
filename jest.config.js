/**
 * @var {ProjectConfig} config
 */
const config = {
  roots: ['<rootDir>'],
  testMatch: ['test/**/*.+(ts|js)', '**/?(*.)+(spec|test).+(ts|js)'],
  transform: {
    '^.+\\.(ts)$': 'ts-jest',
  },
  collectCoverage: true,
  coveragePathIgnorePatterns: [
    '<rootDir>/build/',
    '<rootDir>/node_modules/',
    '<rootDir>/test/',
  ],
  globals: {
    'ts-jest': {
      tsConfig: 'test/tsconfig.json',
    },
  },
};

module.exports = config;
