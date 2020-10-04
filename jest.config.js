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
};

module.exports = config;
