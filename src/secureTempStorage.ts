/**
 * Platform-aware secure temporary storage
 * 
 * Provides secure temporary file storage with platform-specific implementations:
 * - Linux: Uses /dev/shm (RAM-based filesystem) - data never touches disk
 * - Windows: Uses %TEMP% with restricted permissions - data on disk but protected
 * - macOS: Uses system temp with restricted permissions
 * 
 * Note: On Windows, we cannot use DPAPI for the temp file itself because VS Code
 * needs to read/write the file directly. The security relies on:
 * - User-specific temp directory
 * - Restrictive file permissions
 * - Secure deletion on cleanup
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { tempFileLogger as logger } from './logger';
import { secureDelete, createSecureDirectory, SECURE_FILE_PERMISSIONS } from './fileUtils';

/** Linux RAM-based temp storage */
const LINUX_SHM_PATH = '/dev/shm';

/** Prefix for our temp directories */
const TEMP_DIR_PREFIX = 'secureNotes-';

/**
 * Platform type for secure storage
 */
export type SecurePlatform = 'linux-shm' | 'windows-temp' | 'macos-temp' | 'fallback';

/**
 * Information about the secure storage being used
 */
export interface SecureStorageInfo {
    platform: SecurePlatform;
    basePath: string;
    description: string;
    securityLevel: 'high' | 'medium' | 'low';
}

/**
 * Secure temporary storage manager
 * 
 * Handles platform-specific secure temp file operations
 */
export class SecureTempStorage {
    private readonly platform: SecurePlatform;
    private readonly basePath: string;
    private readonly sessionId: string;
    private readonly tempDir: string;

    constructor() {
        this.sessionId = crypto.randomBytes(8).toString('hex');
        
        // Determine platform and storage location
        const { platform, basePath } = this.detectPlatform();
        this.platform = platform;
        this.basePath = basePath;
        this.tempDir = path.join(basePath, `${TEMP_DIR_PREFIX}${this.sessionId}`);

        // Create the session temp directory
        this.initializeDirectory();

        logger.info('SecureTempStorage initialized', {
            platform: this.platform,
            tempDir: this.tempDir
        });
    }

    /**
     * Detect the best available platform for secure storage
     */
    private detectPlatform(): { platform: SecurePlatform; basePath: string } {
        // Linux: Check for /dev/shm (RAM-based, most secure)
        if (process.platform === 'linux' && fs.existsSync(LINUX_SHM_PATH)) {
            return { platform: 'linux-shm', basePath: LINUX_SHM_PATH };
        }

        // Windows: Use user's temp directory
        if (process.platform === 'win32') {
            return { platform: 'windows-temp', basePath: os.tmpdir() };
        }

        // macOS: Use user's temp directory
        if (process.platform === 'darwin') {
            return { platform: 'macos-temp', basePath: os.tmpdir() };
        }

        // Fallback: Use system temp directory
        logger.warn('Unknown platform, using system temp directory');
        return { platform: 'fallback', basePath: os.tmpdir() };
    }

    /**
     * Initialize the session temp directory
     */
    private initializeDirectory(): void {
        if (!fs.existsSync(this.tempDir)) {
            createSecureDirectory(this.tempDir, SECURE_FILE_PERMISSIONS.PRIVATE_DIR);
        }
    }

    /**
     * Get information about the current storage
     */
    getStorageInfo(): SecureStorageInfo {
        switch (this.platform) {
            case 'linux-shm':
                return {
                    platform: 'linux-shm',
                    basePath: this.basePath,
                    description: 'RAM-based storage (/dev/shm) - data never touches disk',
                    securityLevel: 'high'
                };
            case 'windows-temp':
                return {
                    platform: 'windows-temp',
                    basePath: this.basePath,
                    description: 'User temp directory with restricted permissions - data on disk',
                    securityLevel: 'medium'
                };
            case 'macos-temp':
                return {
                    platform: 'macos-temp',
                    basePath: this.basePath,
                    description: 'User temp directory with restricted permissions - data on disk',
                    securityLevel: 'medium'
                };
            default:
                return {
                    platform: 'fallback',
                    basePath: this.basePath,
                    description: 'Standard temp directory - limited protection',
                    securityLevel: 'low'
                };
        }
    }

    /**
     * Check if secure storage is available (any platform-specific storage)
     */
    isSecureStorageAvailable(): boolean {
        return this.platform !== 'fallback';
    }

    /**
     * Check if using RAM-based storage (highest security)
     */
    isRamBased(): boolean {
        return this.platform === 'linux-shm';
    }

    /**
     * Get the session temp directory
     */
    getTempDir(): string {
        return this.tempDir;
    }

    /**
     * Create a unique temp file path
     */
    createTempPath(identifier: string, extension: string): string {
        const hash = crypto.createHash('md5')
            .update(identifier)
            .digest('hex')
            .slice(0, 8);
        
        return path.join(this.tempDir, `${hash}_${extension}`);
    }

    /**
     * Write content to a secure temp file
     */
    writeSecureFile(filePath: string, content: Buffer): void {
        // Ensure the file is in our temp directory
        if (!filePath.startsWith(this.tempDir)) {
            throw new Error('Cannot write outside secure temp directory');
        }

        // Write with secure permissions
        fs.writeFileSync(filePath, content, { mode: 0o600 });
        logger.debug('Wrote secure temp file', { filePath, platform: this.platform });
    }

    /**
     * Read content from a secure temp file
     */
    readSecureFile(filePath: string): Buffer {
        // Ensure the file is in our temp directory
        if (!filePath.startsWith(this.tempDir)) {
            throw new Error('Cannot read outside secure temp directory');
        }

        return fs.readFileSync(filePath);
    }

    /**
     * Securely delete a temp file
     */
    deleteSecureFile(filePath: string): void {
        // Ensure the file is in our temp directory
        if (!filePath.startsWith(this.tempDir)) {
            throw new Error('Cannot delete outside secure temp directory');
        }

        secureDelete(filePath);
        logger.debug('Deleted secure temp file', { filePath });
    }

    /**
     * Check if a temp file exists
     */
    fileExists(filePath: string): boolean {
        return fs.existsSync(filePath);
    }

    /**
     * Clean up the entire session temp directory
     */
    dispose(): void {
        try {
            if (fs.existsSync(this.tempDir)) {
                // Securely delete all files in the directory
                const files = fs.readdirSync(this.tempDir);
                for (const file of files) {
                    secureDelete(path.join(this.tempDir, file));
                }
                
                // Remove the directory
                fs.rmdirSync(this.tempDir);
            }
            logger.info('SecureTempStorage disposed', { tempDir: this.tempDir });
        } catch (error) {
            logger.error('Failed to dispose SecureTempStorage', error as Error, { tempDir: this.tempDir });
        }
    }
}

