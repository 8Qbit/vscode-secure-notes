import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export interface EncryptedFile {
    version: number;
    encryptedKey: string;  // RSA-encrypted AES key (base64)
    iv: string;            // Initialization vector (base64)
    authTag: string;       // GCM auth tag (base64)
    content: string;       // AES-encrypted content (base64)
}

export interface KeyPairPaths {
    publicKeyPath: string;
    privateKeyPath: string;
}

export class NotepadEncryption {
    private publicKey: string | null = null;
    private privateKey: crypto.KeyObject | null = null;
    private isUnlocked: boolean = false;

    /**
     * Check if encryption is enabled in settings
     */
    static isEnabled(): boolean {
        const config = vscode.workspace.getConfiguration('secureNotes');
        return config.get<boolean>('encryption.enabled', false);
    }

    /**
     * Get configured key paths from settings
     */
    static getKeyPaths(): { publicKeyPath: string; privateKeyPath: string } {
        const config = vscode.workspace.getConfiguration('secureNotes');
        return {
            publicKeyPath: config.get<string>('encryption.publicKeyPath', ''),
            privateKeyPath: config.get<string>('encryption.privateKeyPath', '')
        };
    }

    /**
     * Load the public key from the configured path
     */
    async loadPublicKey(): Promise<void> {
        const { publicKeyPath } = NotepadEncryption.getKeyPaths();
        
        if (!publicKeyPath) {
            throw new Error('Public key path not configured. Set notepad.encryption.publicKeyPath in settings.');
        }

        if (!fs.existsSync(publicKeyPath)) {
            throw new Error(`Public key file not found: ${publicKeyPath}`);
        }

        this.publicKey = fs.readFileSync(publicKeyPath, 'utf8');
    }

    /**
     * Load the private key from the configured path
     * @param passphrase Optional passphrase if the private key is encrypted
     */
    async loadPrivateKey(passphrase?: string): Promise<void> {
        const { privateKeyPath } = NotepadEncryption.getKeyPaths();
        
        if (!privateKeyPath) {
            throw new Error('Private key path not configured. Set notepad.encryption.privateKeyPath in settings.');
        }

        if (!fs.existsSync(privateKeyPath)) {
            throw new Error(`Private key file not found: ${privateKeyPath}`);
        }

        const keyContent = fs.readFileSync(privateKeyPath, 'utf8');

        // Load and decrypt the private key (validates passphrase if encrypted)
        try {
            // Store the decrypted key object so we don't need the passphrase again
            this.privateKey = crypto.createPrivateKey({
                key: keyContent,
                passphrase: passphrase
            });
            this.isUnlocked = true;
        } catch (error) {
            if ((error as Error).message.includes('bad decrypt') || 
                (error as Error).message.includes('bad password')) {
                throw new Error('Invalid passphrase for private key');
            }
            throw error;
        }
    }

    /**
     * Load both keys, prompting for passphrase if needed
     */
    async unlock(): Promise<boolean> {
        try {
            await this.loadPublicKey();

            // Try loading private key without passphrase first
            try {
                await this.loadPrivateKey();
                return true;
            } catch (error) {
                // If it fails, prompt for passphrase
                const passphrase = await vscode.window.showInputBox({
                    prompt: 'Enter passphrase for private key',
                    password: true,
                    ignoreFocusOut: true
                });

                if (!passphrase) {
                    return false;
                }

                await this.loadPrivateKey(passphrase);
                return true;
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to unlock encryption: ${(error as Error).message}`);
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
    }

    /**
     * Check if encryption is unlocked (keys loaded)
     */
    getIsUnlocked(): boolean {
        return this.isUnlocked;
    }

    /**
     * Encrypt content using hybrid encryption (AES + RSA)
     */
    encrypt(plaintext: Buffer): EncryptedFile {
        if (!this.publicKey) {
            throw new Error('Public key not loaded. Call loadPublicKey() first.');
        }

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

        return {
            version: 1,
            encryptedKey: encryptedKey.toString('base64'),
            iv: iv.toString('base64'),
            authTag: authTag.toString('base64'),
            content: encrypted.toString('base64')
        };
    }

    /**
     * Decrypt content using hybrid encryption (AES + RSA)
     */
    decrypt(encrypted: EncryptedFile): Buffer {
        if (!this.privateKey) {
            throw new Error('Private key not loaded. Call loadPrivateKey() first.');
        }

        // Decrypt AES key with RSA private key (already decrypted KeyObject)
        const aesKey = crypto.privateDecrypt(
            {
                key: this.privateKey,
                padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
                oaepHash: 'sha256'
            },
            Buffer.from(encrypted.encryptedKey, 'base64')
        );

        // Decrypt content with AES-256-GCM
        const decipher = crypto.createDecipheriv(
            'aes-256-gcm',
            aesKey,
            Buffer.from(encrypted.iv, 'base64')
        );
        decipher.setAuthTag(Buffer.from(encrypted.authTag, 'base64'));

        return Buffer.concat([
            decipher.update(Buffer.from(encrypted.content, 'base64')),
            decipher.final()
        ]);
    }

    /**
     * Encrypt a file and write to disk
     */
    async encryptFile(sourcePath: string, destPath: string): Promise<void> {
        const content = fs.readFileSync(sourcePath);
        const encrypted = this.encrypt(content);
        fs.writeFileSync(destPath, JSON.stringify(encrypted, null, 2));
    }

    /**
     * Read and decrypt a file from disk
     */
    decryptFile(encryptedPath: string): Buffer {
        const content = fs.readFileSync(encryptedPath, 'utf8');
        const encrypted: EncryptedFile = JSON.parse(content);
        return this.decrypt(encrypted);
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
            return parsed.version && parsed.encryptedKey && parsed.iv && parsed.authTag && parsed.content;
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

            crypto.generateKeyPair('rsa', options, (err, publicKey, privateKey) => {
                if (err) {
                    reject(err);
                    return;
                }

                const publicKeyPath = path.join(outputDir, 'notepad_public.pem');
                const privateKeyPath = path.join(outputDir, 'notepad_private.pem');

                fs.writeFileSync(publicKeyPath, publicKey);
                fs.writeFileSync(privateKeyPath, privateKey);

                resolve({ publicKeyPath, privateKeyPath });
            });
        });
    }
}

