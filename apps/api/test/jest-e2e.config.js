module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testRegex: '.*\\.e2e-spec\\.ts$',
  globalSetup: './global-setup.ts',
  // The setup of a spec (a school, its staff, classes, students) takes a few seconds on a slow runner: Jest's 5 s default made CI fail on timing alone.
  testTimeout: 60000,
};
