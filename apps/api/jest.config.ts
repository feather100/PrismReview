import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
  moduleNameMapper: {
    // NestJS apps use path alias @/* -> src/*
    '^@/(.*)$': '<rootDir>/$1',
  },
  // Orchestrator-Tests dürfen länger dauern (LLM-Mock + State-Machine)
  testTimeout: 10000,
};

export default config;
