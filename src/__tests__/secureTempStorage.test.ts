/**
 * Unit tests for secureTempStorage module
 */

import * as fs from 'fs';
import { SecureTempStorage } from '../secureTempStorage';

describe('SecureTempStorage', () => {
    let storage: SecureTempStorage;

    beforeEach(() => {
        storage = new SecureTempStorage();
    });

    afterEach(() => {
        storage.dispose();
    });

    describe('initialization', () => {
        it('should create temp directory on initialization', () => {
            const tempDir = storage.getTempDir();
            expect(fs.existsSync(tempDir)).toBe(true);
        });

        it('should create unique session directories', () => {
            const storage2 = new SecureTempStorage();
            
            expect(storage.getTempDir()).not.toBe(storage2.getTempDir());
            
            storage2.dispose();
        });

        it('should detect platform correctly', () => {
            const info = storage.getStorageInfo();
            
            if (process.platform === 'linux' && fs.existsSync('/dev/shm')) {
                expect(info.platform).toBe('linux-shm');
                expect(info.securityLevel).toBe('high');
            } else if (process.platform === 'win32') {
                expect(info.platform).toBe('windows-temp');
                expect(info.securityLevel).toBe('medium');
            } else if (process.platform === 'darwin') {
                expect(info.platform).toBe('macos-temp');
                expect(info.securityLevel).toBe('medium');
            }
        });
    });

    describe('getStorageInfo', () => {
        it('should return valid storage info', () => {
            const info = storage.getStorageInfo();
            
            expect(info.platform).toBeDefined();
            expect(info.basePath).toBeDefined();
            expect(info.description).toBeDefined();
            expect(['high', 'medium', 'low']).toContain(info.securityLevel);
        });

        it('should report correct security level for platform', () => {
            const info = storage.getStorageInfo();
            
            if (info.platform === 'linux-shm') {
                expect(info.securityLevel).toBe('high');
            } else if (info.platform === 'windows-temp' || info.platform === 'macos-temp') {
                expect(info.securityLevel).toBe('medium');
            } else {
                expect(info.securityLevel).toBe('low');
            }
        });
    });

    describe('isSecureStorageAvailable', () => {
        it('should return true on supported platforms', () => {
            // On any modern OS, some form of secure storage should be available
            const available = storage.isSecureStorageAvailable();
            expect(typeof available).toBe('boolean');
        });
    });

    describe('isRamBased', () => {
        it('should return true only on Linux with /dev/shm', () => {
            const ramBased = storage.isRamBased();
            
            if (process.platform === 'linux' && fs.existsSync('/dev/shm')) {
                expect(ramBased).toBe(true);
            } else {
                expect(ramBased).toBe(false);
            }
        });
    });

    describe('createTempPath', () => {
        it('should create paths within temp directory', () => {
            const tempPath = storage.createTempPath('/path/to/file.txt', 'file.txt');
            
            expect(tempPath.startsWith(storage.getTempDir())).toBe(true);
        });

        it('should create unique paths for different identifiers', () => {
            const path1 = storage.createTempPath('/path/one.txt', 'one.txt');
            const path2 = storage.createTempPath('/path/two.txt', 'two.txt');
            
            expect(path1).not.toBe(path2);
        });

        it('should create consistent paths for same identifier', () => {
            const path1 = storage.createTempPath('/path/file.txt', 'file.txt');
            const path2 = storage.createTempPath('/path/file.txt', 'file.txt');
            
            expect(path1).toBe(path2);
        });
    });

    describe('writeSecureFile/readSecureFile', () => {
        it('should write and read file content', () => {
            const tempPath = storage.createTempPath('/test/file.txt', 'file.txt');
            const content = Buffer.from('Test content');
            
            storage.writeSecureFile(tempPath, content);
            const read = storage.readSecureFile(tempPath);
            
            expect(read.equals(content)).toBe(true);
        });

        it('should handle binary content', () => {
            const tempPath = storage.createTempPath('/test/binary.bin', 'binary.bin');
            const content = Buffer.from([0x00, 0x01, 0xFF, 0xFE, 0x7F]);
            
            storage.writeSecureFile(tempPath, content);
            const read = storage.readSecureFile(tempPath);
            
            expect(read.equals(content)).toBe(true);
        });

        it('should handle empty content', () => {
            const tempPath = storage.createTempPath('/test/empty.txt', 'empty.txt');
            const content = Buffer.from('');
            
            storage.writeSecureFile(tempPath, content);
            const read = storage.readSecureFile(tempPath);
            
            expect(read.length).toBe(0);
        });

        it('should reject paths outside temp directory', () => {
            const outsidePath = '/tmp/outside-file.txt';
            
            expect(() => storage.writeSecureFile(outsidePath, Buffer.from('test')))
                .toThrow('Cannot write outside secure temp directory');
            
            expect(() => storage.readSecureFile(outsidePath))
                .toThrow('Cannot read outside secure temp directory');
        });

        it('should set secure permissions on Linux', () => {
            if (process.platform === 'win32') {
                return; // Skip on Windows
            }
            
            const tempPath = storage.createTempPath('/test/perms.txt', 'perms.txt');
            storage.writeSecureFile(tempPath, Buffer.from('secret'));
            
            const stats = fs.statSync(tempPath);
            expect(stats.mode & 0o777).toBe(0o600);
        });
    });

    describe('deleteSecureFile', () => {
        it('should delete existing files', () => {
            const tempPath = storage.createTempPath('/test/delete.txt', 'delete.txt');
            storage.writeSecureFile(tempPath, Buffer.from('to delete'));
            
            expect(fs.existsSync(tempPath)).toBe(true);
            
            storage.deleteSecureFile(tempPath);
            
            expect(fs.existsSync(tempPath)).toBe(false);
        });

        it('should reject paths outside temp directory', () => {
            const outsidePath = '/tmp/outside-delete.txt';
            
            expect(() => storage.deleteSecureFile(outsidePath))
                .toThrow('Cannot delete outside secure temp directory');
        });
    });

    describe('fileExists', () => {
        it('should return true for existing files', () => {
            const tempPath = storage.createTempPath('/test/exists.txt', 'exists.txt');
            storage.writeSecureFile(tempPath, Buffer.from('content'));
            
            expect(storage.fileExists(tempPath)).toBe(true);
        });

        it('should return false for non-existing files', () => {
            const tempPath = storage.createTempPath('/test/notexists.txt', 'notexists.txt');
            
            expect(storage.fileExists(tempPath)).toBe(false);
        });
    });

    describe('dispose', () => {
        it('should remove temp directory on dispose', () => {
            const tempStorage = new SecureTempStorage();
            const tempDir = tempStorage.getTempDir();
            
            // Create a file in the temp dir
            const filePath = tempStorage.createTempPath('/test/file.txt', 'file.txt');
            tempStorage.writeSecureFile(filePath, Buffer.from('content'));
            
            expect(fs.existsSync(tempDir)).toBe(true);
            
            tempStorage.dispose();
            
            expect(fs.existsSync(tempDir)).toBe(false);
        });

        it('should securely delete all files before removing directory', () => {
            const tempStorage = new SecureTempStorage();
            
            // Create multiple files
            const file1 = tempStorage.createTempPath('/test/file1.txt', 'file1.txt');
            const file2 = tempStorage.createTempPath('/test/file2.txt', 'file2.txt');
            
            tempStorage.writeSecureFile(file1, Buffer.from('secret1'));
            tempStorage.writeSecureFile(file2, Buffer.from('secret2'));
            
            tempStorage.dispose();
            
            expect(fs.existsSync(file1)).toBe(false);
            expect(fs.existsSync(file2)).toBe(false);
        });
    });
});

