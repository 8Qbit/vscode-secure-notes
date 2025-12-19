/**
 * Unit tests for encryption module
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { createTestDir, cleanupTestDir } from './setup';
import { NotepadEncryption } from '../encryption';
import { mockConfigValues } from '../__mocks__/vscode';

// RSA-4096 key generation is slow, increase timeout
jest.setTimeout(60000);

describe('NotepadEncryption', () => {
    let testDir: string;
    let publicKeyPath: string;
    let privateKeyPath: string;

    beforeAll(async () => {
        // Generate test keys once for all tests
        testDir = createTestDir('encryption');
        
        // Ensure the directory exists
        if (!fs.existsSync(testDir)) {
            fs.mkdirSync(testDir, { recursive: true });
        }
        
        const keyPaths = await NotepadEncryption.generateKeyPair(testDir);
        publicKeyPath = keyPaths.publicKeyPath;
        privateKeyPath = keyPaths.privateKeyPath;
    });

    afterAll(() => {
        cleanupTestDir(testDir);
    });

    // Helper to set up config mock for key paths
    function setupConfigMock(pubPath: string, privPath: string) {
        mockConfigValues['publicKeyPath'] = pubPath;
        mockConfigValues['privateKeyPath'] = privPath;
        mockConfigValues['sessionTimeoutMinutes'] = 30;
    }

    // Clear mock config after each test
    afterEach(() => {
        Object.keys(mockConfigValues).forEach(key => delete mockConfigValues[key]);
    });

    describe('generateKeyPair', () => {
        it('should generate RSA key pair files', async () => {
            const keyDir = createTestDir('keygen');
            
            const paths = await NotepadEncryption.generateKeyPair(keyDir);
            
            expect(fs.existsSync(paths.publicKeyPath)).toBe(true);
            expect(fs.existsSync(paths.privateKeyPath)).toBe(true);
            
            const publicKey = fs.readFileSync(paths.publicKeyPath, 'utf8');
            const privateKey = fs.readFileSync(paths.privateKeyPath, 'utf8');
            
            expect(publicKey).toContain('BEGIN PUBLIC KEY');
            expect(privateKey).toContain('BEGIN PRIVATE KEY');
            
            cleanupTestDir(keyDir);
        });

        it('should generate passphrase-protected keys', async () => {
            const keyDir = createTestDir('keygen-pass');
            
            const paths = await NotepadEncryption.generateKeyPair(keyDir, 'testpassphrase');
            
            const privateKey = fs.readFileSync(paths.privateKeyPath, 'utf8');
            expect(privateKey).toContain('BEGIN ENCRYPTED PRIVATE KEY');
            
            cleanupTestDir(keyDir);
        });

        it('should set secure file permissions on Linux', async () => {
            if (process.platform === 'win32') {
                return; // Skip on Windows
            }
            
            const keyDir = createTestDir('keygen-perms');
            const paths = await NotepadEncryption.generateKeyPair(keyDir);
            
            const stats = fs.statSync(paths.privateKeyPath);
            expect(stats.mode & 0o777).toBe(0o600);
            
            cleanupTestDir(keyDir);
        });
    });

    describe('isEncryptedFile', () => {
        it('should return true for valid encrypted files', async () => {
            setupConfigMock(publicKeyPath, privateKeyPath);
            
            const encryption = new NotepadEncryption();
            await encryption.loadPublicKey();
            await encryption.loadPrivateKey();
            
            // Create an encrypted file
            const testFile = path.join(testDir, 'test-isenc.txt');
            const encryptedFile = path.join(testDir, 'test-isenc.txt.enc');
            fs.writeFileSync(testFile, 'test content');
            await encryption.encryptFile(testFile, encryptedFile);
            
            expect(NotepadEncryption.isEncryptedFile(encryptedFile)).toBe(true);
            
            encryption.dispose();
        });

        it('should return false for non-encrypted files', () => {
            const plainFile = path.join(testDir, 'plain.txt');
            fs.writeFileSync(plainFile, 'not encrypted');
            
            expect(NotepadEncryption.isEncryptedFile(plainFile)).toBe(false);
        });

        it('should return false for files without .enc extension', () => {
            expect(NotepadEncryption.isEncryptedFile('/path/to/file.txt')).toBe(false);
        });

        it('should return false for invalid JSON in .enc files', () => {
            const invalidFile = path.join(testDir, 'invalid.enc');
            fs.writeFileSync(invalidFile, 'not valid json');
            
            expect(NotepadEncryption.isEncryptedFile(invalidFile)).toBe(false);
        });
    });

    describe('encrypt/decrypt', () => {
        let encryption: NotepadEncryption;

        beforeEach(async () => {
            setupConfigMock(publicKeyPath, privateKeyPath);
            encryption = new NotepadEncryption();
            await encryption.loadPublicKey();
            await encryption.loadPrivateKey();
        });

        afterEach(() => {
            encryption.dispose();
        });

        it('should encrypt and decrypt text content', () => {
            const plaintext = Buffer.from('Hello, World!');
            
            const encrypted = encryption.encrypt(plaintext);
            const decrypted = encryption.decrypt(encrypted);
            
            expect(decrypted.toString()).toBe('Hello, World!');
        });

        it('should encrypt and decrypt binary content', () => {
            const binary = crypto.randomBytes(1024);
            
            const encrypted = encryption.encrypt(binary);
            const decrypted = encryption.decrypt(encrypted);
            
            expect(decrypted.equals(binary)).toBe(true);
        });

        it('should encrypt and decrypt empty content', () => {
            const empty = Buffer.from('');
            
            const encrypted = encryption.encrypt(empty);
            const decrypted = encryption.decrypt(encrypted);
            
            expect(decrypted.length).toBe(0);
        });

        it('should encrypt and decrypt large content', () => {
            const large = crypto.randomBytes(100 * 1024); // 100KB
            
            const encrypted = encryption.encrypt(large);
            const decrypted = encryption.decrypt(encrypted);
            
            expect(decrypted.equals(large)).toBe(true);
        });

        it('should produce different ciphertext for same plaintext', () => {
            const plaintext = Buffer.from('Same content');
            
            const encrypted1 = encryption.encrypt(plaintext);
            const encrypted2 = encryption.encrypt(plaintext);
            
            // Different IVs should produce different ciphertext
            expect(encrypted1.iv).not.toBe(encrypted2.iv);
            expect(encrypted1.content).not.toBe(encrypted2.content);
        });

        it('should include HMAC for integrity', () => {
            const plaintext = Buffer.from('Content with integrity');
            
            const encrypted = encryption.encrypt(plaintext);
            
            expect(encrypted.hmac).toBeDefined();
            expect(typeof encrypted.hmac).toBe('string');
            expect(encrypted.hmac!.length).toBeGreaterThan(0);
        });

        it('should detect tampered content', () => {
            const plaintext = Buffer.from('Tamper-proof content');
            const encrypted = encryption.encrypt(plaintext);
            
            // Tamper with the encrypted content
            const tamperedBuffer = Buffer.from(encrypted.content, 'base64');
            tamperedBuffer[0] ^= 0xFF;
            encrypted.content = tamperedBuffer.toString('base64');
            
            expect(() => encryption.decrypt(encrypted)).toThrow();
        });
    });

    describe('encryptFile/decryptFile', () => {
        let encryption: NotepadEncryption;

        beforeEach(async () => {
            setupConfigMock(publicKeyPath, privateKeyPath);
            encryption = new NotepadEncryption();
            await encryption.loadPublicKey();
            await encryption.loadPrivateKey();
        });

        afterEach(() => {
            encryption.dispose();
        });

        it('should encrypt and decrypt file', async () => {
            const sourceFile = path.join(testDir, 'source.txt');
            const encryptedFile = path.join(testDir, 'source.txt.enc');
            
            fs.writeFileSync(sourceFile, 'File content to encrypt');
            
            await encryption.encryptFile(sourceFile, encryptedFile);
            expect(fs.existsSync(encryptedFile)).toBe(true);
            
            const decrypted = encryption.decryptFile(encryptedFile);
            expect(decrypted.toString()).toBe('File content to encrypt');
        });

        it('should preserve file content exactly', async () => {
            const sourceFile = path.join(testDir, 'binary.bin');
            const encryptedFile = path.join(testDir, 'binary.bin.enc');
            
            const binaryContent = crypto.randomBytes(5000);
            fs.writeFileSync(sourceFile, binaryContent);
            
            await encryption.encryptFile(sourceFile, encryptedFile);
            const decrypted = encryption.decryptFile(encryptedFile);
            
            expect(decrypted.equals(binaryContent)).toBe(true);
        });
    });

    describe('lock/unlock state', () => {
        it('should track lock state', async () => {
            setupConfigMock(publicKeyPath, privateKeyPath);
            const encryption = new NotepadEncryption();
            
            expect(encryption.getIsUnlocked()).toBe(false);
            
            await encryption.loadPublicKey();
            await encryption.loadPrivateKey();
            
            expect(encryption.getIsUnlocked()).toBe(true);
            
            encryption.lock();
            
            expect(encryption.getIsUnlocked()).toBe(false);
            
            encryption.dispose();
        });

        it('should clear keys on lock', async () => {
            setupConfigMock(publicKeyPath, privateKeyPath);
            const encryption = new NotepadEncryption();
            await encryption.loadPublicKey();
            await encryption.loadPrivateKey();
            
            const plaintext = Buffer.from('Test');
            const encrypted = encryption.encrypt(plaintext);
            
            encryption.lock();
            
            // After locking, decryption should fail
            expect(() => encryption.decrypt(encrypted)).toThrow();
            
            encryption.dispose();
        });
    });
});
