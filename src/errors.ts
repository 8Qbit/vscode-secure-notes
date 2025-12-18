/**
 * Structured error types for SecureNotes extension
 * 
 * Provides specific error classes for different failure scenarios,
 * enabling better error handling and user-facing messages.
 */

import * as vscode from 'vscode';

/**
 * Error codes for categorizing errors
 */
export enum ErrorCode {
    // Encryption errors (1xx)
    ENCRYPTION_NOT_CONFIGURED = 100,
    ENCRYPTION_KEY_NOT_FOUND = 101,
    ENCRYPTION_INVALID_KEY = 102,
    ENCRYPTION_INVALID_PASSPHRASE = 103,
    ENCRYPTION_NOT_UNLOCKED = 104,
    ENCRYPTION_FAILED = 105,
    DECRYPTION_FAILED = 106,
    INTEGRITY_CHECK_FAILED = 107,

    // File operation errors (2xx)
    FILE_NOT_FOUND = 200,
    FILE_ALREADY_EXISTS = 201,
    FILE_ACCESS_DENIED = 202,
    FILE_INVALID_PERMISSIONS = 203,
    FILE_READ_ERROR = 204,
    FILE_WRITE_ERROR = 205,
    DIRECTORY_NOT_FOUND = 206,

    // Temp file errors (3xx)
    TEMP_DIR_NOT_AVAILABLE = 300,
    TEMP_FILE_CREATE_FAILED = 301,
    TEMP_FILE_CLEANUP_FAILED = 302,

    // Configuration errors (4xx)
    CONFIG_BASE_DIR_NOT_SET = 400,
    CONFIG_INVALID = 401,

    // General errors (9xx)
    UNKNOWN_ERROR = 999
}

/**
 * Base error class for SecureNotes extension
 */
export class SecureNotesError extends Error {
    constructor(
        message: string,
        public readonly code: ErrorCode,
        public readonly userMessage?: string,
        public readonly cause?: Error
    ) {
        super(message);
        this.name = 'SecureNotesError';
        
        // Maintains proper stack trace for where error was thrown
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, SecureNotesError);
        }
    }

    /**
     * Get a user-friendly message for display
     */
    getUserMessage(): string {
        return this.userMessage || this.message;
    }

    /**
     * Show this error to the user via VS Code notification
     */
    showError(): void {
        vscode.window.showErrorMessage(this.getUserMessage());
    }

    /**
     * Show this error with an action button
     */
    async showErrorWithAction(
        actionLabel: string,
        action: () => void | Promise<void>
    ): Promise<void> {
        const result = await vscode.window.showErrorMessage(
            this.getUserMessage(),
            actionLabel
        );
        if (result === actionLabel) {
            await action();
        }
    }
}

// ============================================================================
// Encryption Errors
// ============================================================================

export class EncryptionNotConfiguredError extends SecureNotesError {
    constructor(message?: string) {
        super(
            message || 'Encryption keys not configured',
            ErrorCode.ENCRYPTION_NOT_CONFIGURED,
            'Encryption is not configured. Please set up your public and private key paths in settings.'
        );
        this.name = 'EncryptionNotConfiguredError';
    }
}

export class EncryptionKeyNotFoundError extends SecureNotesError {
    constructor(keyPath: string, keyType: 'public' | 'private') {
        super(
            `${keyType} key file not found: ${keyPath}`,
            ErrorCode.ENCRYPTION_KEY_NOT_FOUND,
            `${keyType === 'public' ? 'Public' : 'Private'} key file not found. Please check your settings.`
        );
        this.name = 'EncryptionKeyNotFoundError';
    }
}

export class InvalidPassphraseError extends SecureNotesError {
    constructor() {
        super(
            'Invalid passphrase for private key',
            ErrorCode.ENCRYPTION_INVALID_PASSPHRASE,
            'Invalid passphrase. Please try again.'
        );
        this.name = 'InvalidPassphraseError';
    }
}

export class EncryptionNotUnlockedError extends SecureNotesError {
    constructor() {
        super(
            'Encryption is not unlocked',
            ErrorCode.ENCRYPTION_NOT_UNLOCKED,
            'Please unlock encryption first by entering your passphrase.'
        );
        this.name = 'EncryptionNotUnlockedError';
    }
}

export class EncryptionFailedError extends SecureNotesError {
    constructor(cause?: Error) {
        super(
            `Encryption failed: ${cause?.message || 'Unknown error'}`,
            ErrorCode.ENCRYPTION_FAILED,
            'Failed to encrypt file. Please try again.',
            cause
        );
        this.name = 'EncryptionFailedError';
    }
}

export class DecryptionFailedError extends SecureNotesError {
    constructor(cause?: Error) {
        super(
            `Decryption failed: ${cause?.message || 'Unknown error'}`,
            ErrorCode.DECRYPTION_FAILED,
            'Failed to decrypt file. The file may be corrupted or the wrong key was used.',
            cause
        );
        this.name = 'DecryptionFailedError';
    }
}

export class IntegrityCheckFailedError extends SecureNotesError {
    constructor(filePath?: string) {
        super(
            `Integrity check failed${filePath ? ` for ${filePath}` : ''}`,
            ErrorCode.INTEGRITY_CHECK_FAILED,
            'File integrity check failed. The file may have been tampered with.'
        );
        this.name = 'IntegrityCheckFailedError';
    }
}

// ============================================================================
// File Operation Errors
// ============================================================================

export class FileNotFoundError extends SecureNotesError {
    constructor(filePath: string) {
        super(
            `File not found: ${filePath}`,
            ErrorCode.FILE_NOT_FOUND,
            `File not found: ${filePath}`
        );
        this.name = 'FileNotFoundError';
    }
}

export class FileAlreadyExistsError extends SecureNotesError {
    constructor(filePath: string) {
        super(
            `File already exists: ${filePath}`,
            ErrorCode.FILE_ALREADY_EXISTS,
            `A file with this name already exists.`
        );
        this.name = 'FileAlreadyExistsError';
    }
}

export class FileAccessDeniedError extends SecureNotesError {
    constructor(filePath: string, operation: string) {
        super(
            `Access denied for ${operation} on ${filePath}`,
            ErrorCode.FILE_ACCESS_DENIED,
            `Permission denied. Cannot ${operation} this file.`
        );
        this.name = 'FileAccessDeniedError';
    }
}

export class InvalidFilePermissionsError extends SecureNotesError {
    constructor(filePath: string, expectedMode: number, actualMode: number) {
        super(
            `Invalid file permissions for ${filePath}: expected ${expectedMode.toString(8)}, got ${actualMode.toString(8)}`,
            ErrorCode.FILE_INVALID_PERMISSIONS,
            'File has incorrect permissions. This may be a security risk.'
        );
        this.name = 'InvalidFilePermissionsError';
    }
}

// ============================================================================
// Temp File Errors
// ============================================================================

export class TempDirNotAvailableError extends SecureNotesError {
    constructor() {
        super(
            '/dev/shm is not available',
            ErrorCode.TEMP_DIR_NOT_AVAILABLE,
            'Secure temp storage (/dev/shm) is not available. Encrypted file editing requires Linux.'
        );
        this.name = 'TempDirNotAvailableError';
    }
}

export class TempFileCreateFailedError extends SecureNotesError {
    constructor(tempPath: string, cause?: Error) {
        super(
            `Failed to create temp file: ${tempPath}`,
            ErrorCode.TEMP_FILE_CREATE_FAILED,
            'Failed to create temporary file for editing.',
            cause
        );
        this.name = 'TempFileCreateFailedError';
    }
}

// ============================================================================
// Configuration Errors
// ============================================================================

export class BaseDirectoryNotSetError extends SecureNotesError {
    constructor() {
        super(
            'Base directory not configured',
            ErrorCode.CONFIG_BASE_DIR_NOT_SET,
            'Please set a base directory first using "SecureNotes: Set Base Directory".'
        );
        this.name = 'BaseDirectoryNotSetError';
    }
}

// ============================================================================
// Error Handling Utilities
// ============================================================================

/**
 * Wrap an async function with error handling
 */
export function withErrorHandling<T>(
    fn: () => Promise<T>,
    context?: string
): Promise<T> {
    return fn().catch((error) => {
        if (error instanceof SecureNotesError) {
            error.showError();
            throw error;
        }

        // Wrap unknown errors
        const wrapped = new SecureNotesError(
            `${context ? `[${context}] ` : ''}${error.message}`,
            ErrorCode.UNKNOWN_ERROR,
            'An unexpected error occurred. Please try again.',
            error
        );
        wrapped.showError();
        throw wrapped;
    });
}

/**
 * Create an error handler for a specific context
 */
export function createErrorHandler(context: string) {
    return (error: unknown): never => {
        if (error instanceof SecureNotesError) {
            error.showError();
            throw error;
        }

        const wrapped = new SecureNotesError(
            `[${context}] ${error instanceof Error ? error.message : String(error)}`,
            ErrorCode.UNKNOWN_ERROR,
            'An unexpected error occurred. Please try again.',
            error instanceof Error ? error : undefined
        );
        wrapped.showError();
        throw wrapped;
    };
}

