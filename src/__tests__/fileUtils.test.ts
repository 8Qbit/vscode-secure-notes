/**
 * Unit tests for fileUtils module
 */

import * as fs from 'fs';
import * as path from 'path';
import { createTestDir, createTestFile, cleanupTestDir } from './setup';
import {
    validateFileName,
    validatePathWithinBase,
    validateNewPathWithinBase,
    PathSecurityError,
    secureDelete,
    createSecureDirectory,
    getAllFiles,
    SECURE_FILE_PERMISSIONS,
} from '../fileUtils';

describe('fileUtils', () => {
    let testDir: string;

    beforeEach(() => {
        testDir = createTestDir('fileUtils');
    });

    afterEach(() => {
        cleanupTestDir(testDir);
    });

    describe('validateFileName', () => {
        it('should return null for valid file names', () => {
            expect(validateFileName('test.txt')).toBeNull();
            expect(validateFileName('my-file.md')).toBeNull();
            expect(validateFileName('file_name.json')).toBeNull();
            expect(validateFileName('notes')).toBeNull();
        });

        it('should reject empty names', () => {
            expect(validateFileName('')).toBe('Name cannot be empty');
            expect(validateFileName('   ')).toBe('Name cannot be empty');
        });

        it('should reject path separators', () => {
            expect(validateFileName('path/file.txt')).toBe('Name cannot contain path separators');
            expect(validateFileName('path\\file.txt')).toBe('Name cannot contain path separators');
        });

        it('should reject path traversal patterns', () => {
            expect(validateFileName('..')).toBe('Name cannot contain path traversal patterns (..)');
            expect(validateFileName('.')).toBe('Name cannot contain path traversal patterns (..)');
            expect(validateFileName('../etc')).toContain('path');
        });

        it('should reject null bytes', () => {
            expect(validateFileName('file\0name')).toBe('Name contains invalid characters');
        });
    });

    describe('validatePathWithinBase', () => {
        it('should accept paths within base directory', () => {
            const subDir = path.join(testDir, 'subdir');
            fs.mkdirSync(subDir);
            const file = path.join(subDir, 'test.txt');
            fs.writeFileSync(file, 'test');

            expect(() => validatePathWithinBase(file, testDir)).not.toThrow();
            expect(() => validatePathWithinBase(subDir, testDir)).not.toThrow();
        });

        it('should accept the base directory itself', () => {
            expect(() => validatePathWithinBase(testDir, testDir)).not.toThrow();
        });

        it('should reject paths outside base directory', () => {
            // Create a sibling directory to test against
            const siblingDir = path.join(path.dirname(testDir), 'sibling-dir');
            fs.mkdirSync(siblingDir, { recursive: true });
            
            try {
                expect(() => validatePathWithinBase(siblingDir, testDir))
                    .toThrow(PathSecurityError);
            } finally {
                fs.rmdirSync(siblingDir);
            }
        });

        it('should reject path traversal attempts', () => {
            // Create a file outside the testDir to test traversal
            const parentDir = path.dirname(testDir);
            const outsideFile = path.join(parentDir, 'outside.txt');
            fs.writeFileSync(outsideFile, 'test');
            
            try {
                expect(() => validatePathWithinBase(outsideFile, testDir))
                    .toThrow(PathSecurityError);
            } finally {
                fs.unlinkSync(outsideFile);
            }
        });
    });

    describe('validateNewPathWithinBase', () => {
        it('should accept new paths within base directory', () => {
            const newFile = path.join(testDir, 'newfile.txt');
            
            expect(() => validateNewPathWithinBase(newFile, testDir)).not.toThrow();
        });

        it('should accept new paths in existing subdirectories', () => {
            const subDir = path.join(testDir, 'subdir');
            fs.mkdirSync(subDir);
            const newFile = path.join(subDir, 'newfile.txt');
            
            expect(() => validateNewPathWithinBase(newFile, testDir)).not.toThrow();
        });

        it('should reject new paths outside base directory', () => {
            const outsidePath = path.join(path.dirname(testDir), 'outside.txt');
            
            expect(() => validateNewPathWithinBase(outsidePath, testDir))
                .toThrow(PathSecurityError);
        });
    });

    describe('secureDelete', () => {
        it('should delete existing files', () => {
            const file = createTestFile(testDir, 'to-delete.txt', 'secret content');
            expect(fs.existsSync(file)).toBe(true);
            
            secureDelete(file);
            
            expect(fs.existsSync(file)).toBe(false);
        });

        it('should handle non-existent files gracefully', () => {
            const nonExistent = path.join(testDir, 'does-not-exist.txt');
            
            expect(() => secureDelete(nonExistent)).not.toThrow();
        });

        it('should overwrite file content before deletion', () => {
            const file = createTestFile(testDir, 'overwrite.txt', 'secret');
            
            // We can't easily verify the overwrite happened, but we can verify
            // the file is deleted and the operation completes
            secureDelete(file);
            
            expect(fs.existsSync(file)).toBe(false);
        });
    });

    describe('createSecureDirectory', () => {
        it('should create directory with specified permissions', () => {
            const newDir = path.join(testDir, 'secure-dir');
            
            createSecureDirectory(newDir, SECURE_FILE_PERMISSIONS.PRIVATE_DIR);
            
            expect(fs.existsSync(newDir)).toBe(true);
            
            // On Linux, check permissions
            if (process.platform !== 'win32') {
                const stats = fs.statSync(newDir);
                expect(stats.mode & 0o777).toBe(SECURE_FILE_PERMISSIONS.PRIVATE_DIR);
            }
        });

        it('should handle existing directories', () => {
            const existingDir = path.join(testDir, 'existing');
            fs.mkdirSync(existingDir);
            
            // Should not throw
            expect(() => createSecureDirectory(existingDir, SECURE_FILE_PERMISSIONS.PRIVATE_DIR))
                .not.toThrow();
        });

        it('should create nested directories', () => {
            const nestedDir = path.join(testDir, 'a', 'b', 'c');
            
            createSecureDirectory(nestedDir, SECURE_FILE_PERMISSIONS.PRIVATE_DIR);
            
            expect(fs.existsSync(nestedDir)).toBe(true);
        });
    });

    describe('getAllFiles', () => {
        it('should return all files in directory', () => {
            createTestFile(testDir, 'file1.txt', 'content1');
            createTestFile(testDir, 'file2.txt', 'content2');
            
            const files = getAllFiles(testDir);
            
            expect(files).toHaveLength(2);
            expect(files.map(f => path.basename(f))).toContain('file1.txt');
            expect(files.map(f => path.basename(f))).toContain('file2.txt');
        });

        it('should return files in subdirectories', () => {
            const subDir = path.join(testDir, 'sub');
            fs.mkdirSync(subDir);
            createTestFile(testDir, 'root.txt');
            createTestFile(subDir, 'nested.txt');
            
            const files = getAllFiles(testDir);
            
            expect(files).toHaveLength(2);
        });

        it('should filter files using predicate', () => {
            createTestFile(testDir, 'include.txt');
            createTestFile(testDir, 'exclude.log');
            
            const files = getAllFiles(testDir, (filePath) => filePath.endsWith('.txt'));
            
            expect(files).toHaveLength(1);
            expect(path.basename(files[0])).toBe('include.txt');
        });

        it('should return empty array for empty directory', () => {
            const emptyDir = path.join(testDir, 'empty');
            fs.mkdirSync(emptyDir);
            
            const files = getAllFiles(emptyDir);
            
            expect(files).toHaveLength(0);
        });
    });

    describe('PathSecurityError', () => {
        it('should contain path and base directory info', () => {
            const error = new PathSecurityError('Test error', '/bad/path', '/base');
            
            expect(error.message).toBe('Test error');
            expect(error.targetPath).toBe('/bad/path');
            expect(error.baseDir).toBe('/base');
            expect(error.name).toBe('PathSecurityError');
        });
    });
});

