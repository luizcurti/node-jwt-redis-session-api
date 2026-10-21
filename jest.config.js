const coveragePathIgnorePatterns = [
  '/node_modules/',
  '/src/__tests__/',
  '/src/server.ts',
  '/src/routes.ts',
  '/src/docs/',
  '/src/@types/',
];

const baseProject = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  collectCoverageFrom: ['src/**/*.ts'],
  coveragePathIgnorePatterns,
};

const infraProject = {
  ...baseProject,
  setupFiles: ['<rootDir>/src/__tests__/testSetup/testEnv.js'],
  globalSetup: '<rootDir>/src/__tests__/testSetup/globalSetup.js',
  globalTeardown: '<rootDir>/src/__tests__/testSetup/globalTeardown.js',
};

module.exports = {
  testTimeout: 20000,
  collectCoverageFrom: ['src/**/*.ts'],
  coveragePathIgnorePatterns,
  coverageThreshold: {
    global: {
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90,
    },
  },
  forceExit: true,
  projects: [
    {
      ...baseProject,
      displayName: 'unit',
      testMatch: ['<rootDir>/src/__tests__/unit/**/*.test.ts'],
    },
    {
      ...infraProject,
      displayName: 'integration',
      testMatch: ['<rootDir>/src/__tests__/integration/**/*.test.ts'],
    },
    {
      ...infraProject,
      displayName: 'e2e',
      testMatch: ['<rootDir>/src/__tests__/e2e/**/*.test.ts'],
    },
  ],
};
