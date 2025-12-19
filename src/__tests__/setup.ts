/**
 * Jest test setup file
 * 
 * Runs before all tests to set up the test environment.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Create a temp directory for tests
const testTempDir = path.join(os.tmpdir(), 'secure-notes-test');

beforeAll(() => {
    // Ensure test temp directory exists
    if (!fs.existsSync(testTempDir)) {
        fs.mkdirSync(testTempDir, { recursive: true });
    }
});

afterAll(() => {
    // Clean up test temp directory
    if (fs.existsSync(testTempDir)) {
        fs.rmSync(testTempDir, { recursive: true, force: true });
    }
});

// Helper to create test directories
export function createTestDir(name: string): string {
    const dir = path.join(testTempDir, name, Date.now().toString());
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

// Helper to create test files
export function createTestFile(dir: string, name: string, content: string = ''): string {
    const filePath = path.join(dir, name);
    fs.writeFileSync(filePath, content);
    return filePath;
}

// Helper to clean up a test directory
export function cleanupTestDir(dir: string): void {
    if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

// Global test timeout
jest.setTimeout(10000);

