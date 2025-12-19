/**
 * Encryption module for SecureNotes extension
 * 
 * Implements hybrid encryption (RSA + AES-256-GCM) with HMAC integrity verification.
 * Supports session timeout for automatic locking.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { EncryptedFile, KeyPairPaths, getEncryptionConfig } from './types';
import { encryptionLogger as logger } from './logger';
import {
    EncryptionNotConfiguredError,
    EncryptionKeyNotFoundError,
    InvalidPassphraseError,
    EncryptionNotUnlockedError,
    EncryptionFailedError,
    DecryptionFailedError,
    IntegrityCheckFailedError
} from './errors';
import { verifyFilePermissions, SECURE_FILE_PERMISSIONS } from './fileUtils';

/** Current encryption format version */
const ENCRYPTION_VERSION = 2;

/** HMAC algorithm for integrity verification */
const HMAC_ALGORITHM = 'sha256';

/**
 * Event emitter for encryption state changes
 */
export class EncryptionStateEmitter {
    private readonly _onStateChange = new vscode.EventEmitter<{ isUnlocked: boolean }>();
    readonly onStateChange = this._onStateChange.event;

    fire(isUnlocked: boolean): void {
        this._onStateChange.fire({ isUnlocked });
    }

    dispose(): void {
        this._onStateChange.dispose();
    }
}

/**
 * Main encryption class for SecureNotes
 * 
 * Handles:
 * - RSA key loading and management
 * - Hybrid encryption (RSA + AES-256-GCM)
 * - HMAC integrity verification
 * - Session timeout for auto-lock
 */
export class NotepadEncryption implements vscode.Disposable {
    private publicKey: string | null = null;
    private privateKey: crypto.KeyObject | null = null;
    private isUnlocked: boolean = false;
    private sessionTimeoutHandle: NodeJS.Timeout | null = null;
    private lastActivity: Date = new Date();
    
    public readonly stateEmitter = new EncryptionStateEmitter();
    private disposables: vscode.Disposable[] = [];

    constructor() {
        // Watch for configuration changes
        this.disposables.push(
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('secureNotes.encryption.sessionTimeoutMinutes')) {
                    this.resetSessionTimeout();
                }
            })
        );
    }

    // ========================================================================
    // Static Methods
    // ========================================================================

    /**
     * Check if encryption is enabled in settings
     */
    static isEnabled(): boolean {
        return getEncryptionConfig().enabled;
    }

    /**
     * Get configured key paths from settings
     */
    static getKeyPaths(): KeyPairPaths {
        const config = getEncryptionConfig();
        return {
            publicKeyPath: config.publicKeyPath,
            privateKeyPath: config.privateKeyPath
        };
    }

    /**
     * Check if a file is an encrypted notepad file
     */
    static isEncryptedFile(filePath: string): boolean {
        if (!filePath.endsWith('.enc')) {
            return false;
        }

        try {
            const content = fs.readFileSync(filePath, 'utf8');
            const parsed = JSON.parse(content);
            return (
                typeof parsed.version === 'number' &&
                typeof parsed.encryptedKey === 'string' &&
                typeof parsed.iv === 'string' &&
                typeof parsed.authTag === 'string' &&
                typeof parsed.content === 'string'
            );
        } catch {
            return false;
        }
    }

    /**
     * Generate a new RSA key pair
     */
    static async generateKeyPair(outputDir: string, passphrase?: string): Promise<KeyPairPaths> {
        return new Promise((resolve, reject) => {
            const options: crypto.RSAKeyPairOptions<'pem', 'pem'> = {
                modulusLength: 4096,
                publicKeyEncoding: {
                    type: 'spki',
                    format: 'pem'
                },
                privateKeyEncoding: {
                    type: 'pkcs8',
                    format: 'pem',
                    ...(passphrase ? { cipher: 'aes-256-cbc', passphrase } : {})
                }
            };

            logger.info('Generating RSA key pair', { outputDir });

            crypto.generateKeyPair('rsa', options, (err, publicKey, privateKey) => {
                if (err) {
                    logger.error('Failed to generate key pair', err);
                    reject(err);
                    return;
                }

                const publicKeyPath = path.join(outputDir, 'secureNotes_public.pem');
                const privateKeyPath = path.join(outputDir, 'secureNotes_private.pem');

                // Write keys with appropriate permissions
                fs.writeFileSync(publicKeyPath, publicKey, { mode: SECURE_FILE_PERMISSIONS.READABLE });
                fs.writeFileSync(privateKeyPath, privateKey, { mode: SECURE_FILE_PERMISSIONS.PRIVATE });

                logger.info('Key pair generated successfully', { publicKeyPath, privateKeyPath });

                resolve({ publicKeyPath, privateKeyPath });
            });
        });
    }

    // ========================================================================
    // Key Loading
    // ========================================================================

    /**
     * Load the public key from the configured path
     */
    async loadPublicKey(): Promise<void> {
        const { publicKeyPath } = NotepadEncryption.getKeyPaths();

        if (!publicKeyPath) {
            throw new EncryptionNotConfiguredError('Public key path not configured');
        }

        if (!fs.existsSync(publicKeyPath)) {
            throw new EncryptionKeyNotFoundError(publicKeyPath, 'public');
        }

        this.publicKey = fs.readFileSync(publicKeyPath, 'utf8');
        logger.info('Public key loaded', { path: publicKeyPath });
    }

    /**
     * Load the private key from the configured path
     * @param passphrase Optional passphrase if the private key is encrypted
     */
    async loadPrivateKey(passphrase?: string): Promise<void> {
        const { privateKeyPath } = NotepadEncryption.getKeyPaths();

        if (!privateKeyPath) {
            throw new EncryptionNotConfiguredError('Private key path not configured');
        }

        if (!fs.existsSync(privateKeyPath)) {
            throw new EncryptionKeyNotFoundError(privateKeyPath, 'private');
        }

        // Verify private key file has secure permissions (mode 600)
        const hasSecurePerms = verifyFilePermissions(privateKeyPath, SECURE_FILE_PERMISSIONS.PRIVATE, false);
        if (!hasSecurePerms) {
            // On Linux/macOS, insecure permissions are a serious issue
            if (process.platform !== 'win32') {
                const stats = fs.statSync(privateKeyPath);
                const actualMode = stats.mode & 0o777;
                throw new EncryptionNotConfiguredError(
                    `Private key has insecure permissions (${actualMode.toString(8)}). ` +
                    `Run: chmod 600 "${privateKeyPath}"`
                );
            }
        }

        const keyContent = fs.readFileSync(privateKeyPath, 'utf8');

        try {
            this.privateKey = crypto.createPrivateKey({
                key: keyContent,
                passphrase: passphrase
            });
            this.isUnlocked = true;
            logger.info('Private key loaded and decrypted');
        } catch (error) {
            const errMsg = (error as Error).message;
            // Handle various passphrase-related errors from OpenSSL/Node crypto
            if (errMsg.includes('bad decrypt') || 
                errMsg.includes('bad password') ||
                errMsg.includes('interrupted') ||
                errMsg.includes('cancelled')) {
                throw new InvalidPassphraseError();
            }
            throw error;
        }
    }

    // ========================================================================
    // Lock/Unlock
    // ========================================================================

    /**
     * Load both keys, prompting for passphrase if needed
     */
    async unlock(): Promise<boolean> {
        try {
            await this.loadPublicKey();

            // Try loading private key without passphrase first
            try {
                await this.loadPrivateKey();
            } catch (error) {
                // Check if this is a passphrase-related error
                const needsPassphrase = error instanceof InvalidPassphraseError ||
                    (error instanceof Error && (
                        error.message.includes('passphrase') ||
                        error.message.includes('interrupted') ||
                        error.message.includes('cancelled') ||
                        error.message.includes('bad decrypt')
                    ));

                if (!needsPassphrase) {
                    throw error;
                }

                // Prompt for passphrase
                const passphrase = await vscode.window.showInputBox({
                    prompt: 'Enter passphrase for private key',
                    password: true,
                    ignoreFocusOut: true
                });

                if (!passphrase) {
                    logger.info('Unlock cancelled by user');
                    return false;
                }

                await this.loadPrivateKey(passphrase);
            }

            this.stateEmitter.fire(true);
            this.resetSessionTimeout();
            logger.info('Encryption unlocked');
            return true;
        } catch (error) {
            logger.error('Failed to unlock encryption', error as Error);
            if (error instanceof Error) {
                vscode.window.showErrorMessage(`Failed to unlock: ${error.message}`);
            }
            return false;
        }
    }

    /**
     * Lock the encryption (clear keys from memory)
     */
    lock(): void {
        this.publicKey = null;
        this.privateKey = null;
        this.isUnlocked = false;
        this.clearSessionTimeout();
        this.stateEmitter.fire(false);
        logger.info('Encryption locked - keys cleared from memory');
    }

    /**
     * Check if encryption is unlocked (keys loaded)
     */
    getIsUnlocked(): boolean {
        return this.isUnlocked;
    }

    // ========================================================================
    // Session Timeout
    // ========================================================================

    /**
     * Record activity to reset the session timeout
     */
    recordActivity(): void {
        this.lastActivity = new Date();
        this.resetSessionTimeout();
    }

    /**
     * Reset the session timeout based on configuration
     */
    private resetSessionTimeout(): void {
        this.clearSessionTimeout();

        if (!this.isUnlocked) {
            return;
        }

        const config = getEncryptionConfig();
        const timeoutMinutes = config.sessionTimeoutMinutes;

        if (timeoutMinutes <= 0) {
            // Timeout disabled
            return;
        }

        const timeoutMs = timeoutMinutes * 60 * 1000;

        this.sessionTimeoutHandle = setTimeout(() => {
            logger.info('Session timeout - auto-locking', { timeoutMinutes });
            vscode.window.showWarningMessage(
                'SecureNotes session timed out. Notes have been locked.',
                'Unlock'
            ).then(selection => {
                if (selection === 'Unlock') {
                    vscode.commands.executeCommand('secureNotes.unlock');
                }
            });
            this.lock();
        }, timeoutMs);

        logger.debug('Session timeout reset', { timeoutMinutes });
    }

    /**
     * Clear the session timeout
     */
    private clearSessionTimeout(): void {
        if (this.sessionTimeoutHandle) {
            clearTimeout(this.sessionTimeoutHandle);
            this.sessionTimeoutHandle = null;
        }
    }

    // ========================================================================
    // Encryption/Decryption
    // ========================================================================

    /**
     * Encrypt content using hybrid encryption (AES + RSA) with HMAC integrity
     */
    encrypt(plaintext: Buffer): EncryptedFile {
        if (!this.publicKey) {
            throw new EncryptionNotUnlockedError();
        }

        try {
            // Generate random AES-256 key and IV
            const aesKey = crypto.randomBytes(32);
            const iv = crypto.randomBytes(16);

            // Encrypt content with AES-256-GCM
            const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv);
            const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
            const authTag = cipher.getAuthTag();

            // Encrypt AES key with RSA public key
            const encryptedKey = crypto.publicEncrypt(
                {
                    key: this.publicKey,
                    padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
                    oaepHash: 'sha256'
                },
                aesKey
            );

            // Create HMAC of encrypted content for integrity verification
            const hmac = crypto.createHmac(HMAC_ALGORITHM, aesKey);
            hmac.update(encrypted);
            const hmacDigest = hmac.digest();

            this.recordActivity();

            return {
                version: ENCRYPTION_VERSION,
                encryptedKey: encryptedKey.toString('base64'),
                iv: iv.toString('base64'),
                authTag: authTag.toString('base64'),
                content: encrypted.toString('base64'),
                hmac: hmacDigest.toString('base64')
            };
        } catch (error) {
            logger.error('Encryption failed', error as Error);
            throw new EncryptionFailedError(error as Error);
        }
    }

    /**
     * Decrypt content using hybrid encryption (AES + RSA) with HMAC verification
     */
    decrypt(encrypted: EncryptedFile): Buffer {
        if (!this.privateKey) {
            throw new EncryptionNotUnlockedError();
        }

        try {
            // Decrypt AES key with RSA private key
            const aesKey = crypto.privateDecrypt(
                {
                    key: this.privateKey,
                    padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
                    oaepHash: 'sha256'
                },
                Buffer.from(encrypted.encryptedKey, 'base64')
            );

            const encryptedContent = Buffer.from(encrypted.content, 'base64');

            // Verify HMAC if present (version 2+)
            if (encrypted.hmac && encrypted.version >= 2) {
                const hmac = crypto.createHmac(HMAC_ALGORITHM, aesKey);
                hmac.update(encryptedContent);
                const expectedHmac = hmac.digest();
                const providedHmac = Buffer.from(encrypted.hmac, 'base64');

                if (!crypto.timingSafeEqual(expectedHmac, providedHmac)) {
                    throw new IntegrityCheckFailedError();
                }
            }

            // Decrypt content with AES-256-GCM
            const decipher = crypto.createDecipheriv(
                'aes-256-gcm',
                aesKey,
                Buffer.from(encrypted.iv, 'base64')
            );
            decipher.setAuthTag(Buffer.from(encrypted.authTag, 'base64'));

            this.recordActivity();

            return Buffer.concat([
                decipher.update(encryptedContent),
                decipher.final()
            ]);
        } catch (error) {
            if (error instanceof IntegrityCheckFailedError) {
                throw error;
            }
            logger.error('Decryption failed', error as Error);
            throw new DecryptionFailedError(error as Error);
        }
    }

    /**
     * Encrypt a file and write to disk
     */
    async encryptFile(sourcePath: string, destPath: string): Promise<void> {
        const content = fs.readFileSync(sourcePath);
        const encrypted = this.encrypt(content);
        // Write with secure permissions (owner read/write only)
        fs.writeFileSync(destPath, JSON.stringify(encrypted, null, 2), { 
            mode: SECURE_FILE_PERMISSIONS.PRIVATE 
        });
        logger.debug('File encrypted', { source: sourcePath, dest: destPath });
    }

    /**
     * Read and decrypt a file from disk
     */
    decryptFile(encryptedPath: string): Buffer {
        const content = fs.readFileSync(encryptedPath, 'utf8');
        const encrypted: EncryptedFile = JSON.parse(content);
        return this.decrypt(encrypted);
    }

    // ========================================================================
    // Disposal
    // ========================================================================

    dispose(): void {
        this.lock();
        this.stateEmitter.dispose();
        for (const d of this.disposables) {
            d.dispose();
        }
    }
}
