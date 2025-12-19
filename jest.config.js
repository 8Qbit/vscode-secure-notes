/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>/src'],
    testMatch: ['**/*.test.ts'],
    moduleFileExtensions: ['ts', 'js'],
    collectCoverageFrom: [
        'src/**/*.ts',
        '!src/**/*.test.ts',
        '!src/extension.ts',  // Extension entry point requires VS Code
    ],
    coverageDirectory: 'coverage',
    coverageReporters: ['text', 'lcov', 'html'],
    // Mock VS Code module since it's not available in tests
    moduleNameMapper: {
        '^vscode$': '<rootDir>/src/__mocks__/vscode.ts'
    },
    // Setup file to run before tests
    setupFilesAfterEnv: ['<rootDir>/src/__tests__/setup.ts'],
};

