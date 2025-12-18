/**
 * File system utilities for SecureNotes extension
 * 
 * Provides secure file operations, permission verification, and debouncing.
 */

import * as fs from 'fs';
import * as path from 'path';
import { logger } from './logger';
import { 
    FileNotFoundError, 
    FileAccessDeniedError, 
    InvalidFilePermissionsError 
} from './errors';

const fileLogger = logger.child('FileUtils');

// ============================================================================
// File Permission Utilities
// ============================================================================

/**
 * Expected permissions for sensitive files
 */
export const SECURE_FILE_PERMISSIONS = {
    /** Read/write for owner only (600) */
    PRIVATE: 0o600,
    /** Read/write/execute for owner only (700) */
    PRIVATE_DIR: 0o700,
    /** Read for all, write for owner (644) */
    READABLE: 0o644
};

/**
 * Verify that a file has the expected permissions
 * @param filePath Path to the file
 * @param expectedMode Expected permission mode
 * @param strict If true, throws on mismatch; if false, logs warning
 * @returns true if permissions match
 */
export function verifyFilePermissions(
    filePath: string,
    expectedMode: number,
    strict: boolean = false
): boolean {
    try {
        const stats = fs.statSync(filePath);
        const actualMode = stats.mode & 0o777; // Get permission bits only
        
        if (actualMode !== expectedMode) {
            const message = `File ${filePath} has permissions ${actualMode.toString(8)}, expected ${expectedMode.toString(8)}`;
            
            if (strict) {
                throw new InvalidFilePermissionsError(filePath, expectedMode, actualMode);
            } else {
                fileLogger.warn(message);
                return false;
            }
        }
        
        return true;
    } catch (error) {
        if (error instanceof InvalidFilePermissionsError) {
            throw error;
        }
        fileLogger.error('Failed to verify file permissions', error as Error, { filePath });
        return false;
    }
}

/**
 * Set secure permissions on a file
 * @param filePath Path to the file
 * @param mode Permission mode (default: 0o600)
 */
export function setSecurePermissions(filePath: string, mode: number = SECURE_FILE_PERMISSIONS.PRIVATE): void {
    try {
        fs.chmodSync(filePath, mode);
        fileLogger.debug(`Set permissions ${mode.toString(8)} on ${filePath}`);
    } catch (error) {
        fileLogger.error('Failed to set file permissions', error as Error, { filePath, mode });
        throw new FileAccessDeniedError(filePath, 'set permissions');
    }
}

// ============================================================================
// Secure File Operations
// ============================================================================

/**
 * Securely delete a file by overwriting with zeros before unlinking
 * @param filePath Path to the file to delete
 */
export function secureDelete(filePath: string): void {
    if (!fs.existsSync(filePath)) {
        return;
    }

    try {
        const stats = fs.statSync(filePath);
        
        // Overwrite with zeros
        const zeros = Buffer.alloc(stats.size, 0);
        fs.writeFileSync(filePath, zeros);
        
        // Then delete
        fs.unlinkSync(filePath);
        
        fileLogger.debug(`Securely deleted ${filePath}`);
    } catch (error) {
        fileLogger.error('Failed to securely delete file', error as Error, { filePath });
        
        // Try regular delete as fallback
        try {
            fs.unlinkSync(filePath);
        } catch {
            // Ignore secondary error
        }
    }
}

/**
 * Write content to file with secure permissions
 * @param filePath Path to the file
 * @param content Content to write
 * @param mode Permission mode (default: 0o600)
 */
export function secureWriteFile(
    filePath: string,
    content: Buffer | string,
    mode: number = SECURE_FILE_PERMISSIONS.PRIVATE
): void {
    try {
        fs.writeFileSync(filePath, content, { mode });
        fileLogger.debug(`Wrote secure file ${filePath}`);
    } catch (error) {
        fileLogger.error('Failed to write secure file', error as Error, { filePath });
        throw new FileAccessDeniedError(filePath, 'write');
    }
}

/**
 * Read file content with permission check
 * @param filePath Path to the file
 * @param checkPermissions Whether to verify permissions (default: true)
 */
export function secureReadFile(filePath: string, checkPermissions: boolean = true): Buffer {
    if (!fs.existsSync(filePath)) {
        throw new FileNotFoundError(filePath);
    }

    if (checkPermissions) {
        verifyFilePermissions(filePath, SECURE_FILE_PERMISSIONS.PRIVATE, false);
    }

    try {
        return fs.readFileSync(filePath);
    } catch (error) {
        fileLogger.error('Failed to read file', error as Error, { filePath });
        throw new FileAccessDeniedError(filePath, 'read');
    }
}

// ============================================================================
// Directory Utilities
// ============================================================================

/**
 * Create a directory with secure permissions
 * @param dirPath Path to the directory
 * @param mode Permission mode (default: 0o700)
 */
export function createSecureDirectory(
    dirPath: string,
    mode: number = SECURE_FILE_PERMISSIONS.PRIVATE_DIR
): void {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true, mode });
        fileLogger.debug(`Created secure directory ${dirPath}`);
    }
}

/**
 * Recursively get all files in a directory
 * @param dirPath Directory path
 * @param filter Optional filter function
 */
export function getAllFiles(
    dirPath: string,
    filter?: (filePath: string, isDirectory: boolean) => boolean
): string[] {
    const files: string[] = [];

    if (!fs.existsSync(dirPath)) {
        return files;
    }

    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
        if (entry.name.startsWith('.')) {
            continue;
        }

        const fullPath = path.join(dirPath, entry.name);
        const isDir = entry.isDirectory();

        if (filter && !filter(fullPath, isDir)) {
            continue;
        }

        if (isDir) {
            files.push(...getAllFiles(fullPath, filter));
        } else {
            files.push(fullPath);
        }
    }

    return files;
}

// ============================================================================
// Debouncing Utilities
// ============================================================================

/**
 * Debounce function that delays execution until after wait milliseconds
 * have elapsed since the last time it was invoked.
 */
export function debounce<T extends (...args: unknown[]) => void>(
    func: T,
    wait: number
): T & { cancel: () => void } {
    let timeoutId: NodeJS.Timeout | null = null;

    const debounced = ((...args: unknown[]) => {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }

        timeoutId = setTimeout(() => {
            func(...args);
            timeoutId = null;
        }, wait);
    }) as T & { cancel: () => void };

    debounced.cancel = () => {
        if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
        }
    };

    return debounced;
}

/**
 * Throttle function that only allows execution once per wait milliseconds
 */
export function throttle<T extends (...args: unknown[]) => void>(
    func: T,
    wait: number
): T {
    let lastExecution = 0;
    let timeoutId: NodeJS.Timeout | null = null;

    return ((...args: unknown[]) => {
        const now = Date.now();
        const timeSinceLastExecution = now - lastExecution;

        if (timeSinceLastExecution >= wait) {
            lastExecution = now;
            func(...args);
        } else if (!timeoutId) {
            timeoutId = setTimeout(() => {
                lastExecution = Date.now();
                func(...args);
                timeoutId = null;
            }, wait - timeSinceLastExecution);
        }
    }) as T;
}

/**
 * Create a debounced callback for file system events
 * Groups rapid events on the same file together
 */
export function createDebouncedFileHandler(
    handler: (filePath: string) => void,
    wait: number = 100
): (filePath: string) => void {
    const pendingFiles = new Map<string, NodeJS.Timeout>();

    return (filePath: string) => {
        const existing = pendingFiles.get(filePath);
        if (existing) {
            clearTimeout(existing);
        }

        const timeoutId = setTimeout(() => {
            pendingFiles.delete(filePath);
            handler(filePath);
        }, wait);

        pendingFiles.set(filePath, timeoutId);
    };
}

