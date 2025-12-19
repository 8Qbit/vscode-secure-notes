/**
 * TypeScript interfaces and types for SecureNotes extension
 */

import * as vscode from 'vscode';

// ============================================================================
// Encryption Types
// ============================================================================

/**
 * Structure of an encrypted file stored on disk
 */
export interface EncryptedFile {
    /** Version of the encryption format */
    version: number;
    /** RSA-encrypted AES key (base64) */
    encryptedKey: string;
    /** Initialization vector (base64) */
    iv: string;
    /** GCM authentication tag (base64) */
    authTag: string;
    /** AES-encrypted content (base64) */
    content: string;
    /** HMAC of the encrypted content for integrity verification (base64) */
    hmac?: string;
}

/**
 * Paths to RSA key pair files
 */
export interface KeyPairPaths {
    publicKeyPath: string;
    privateKeyPath: string;
}

/**
 * Encryption configuration from VS Code settings
 */
export interface EncryptionConfig {
    publicKeyPath: string;
    privateKeyPath: string;
    sessionTimeoutMinutes: number;
}

// ============================================================================
// File Management Types
// ============================================================================

/**
 * Mapping between temp file paths and encrypted file paths
 */
export interface FileMapping {
    tempPath: string;
    encryptedPath: string;
}

/**
 * State of a managed temp file
 */
export interface TempFileState {
    tempPath: string;
    encryptedPath: string;
    watcher: vscode.FileSystemWatcher;
    lastModified: Date;
}

/**
 * Options for creating a temp file
 */
export interface TempFileOptions {
    /** Unix file permissions (default: 0o600) */
    mode?: number;
    /** Whether to overwrite existing file */
    overwrite?: boolean;
}

// ============================================================================
// Tree View Types
// ============================================================================

/**
 * Type of tree item in the file browser
 */
export type TreeItemType = 'file' | 'folder' | 'encryptedFile';

/**
 * Properties for creating a NoteItem
 */
export interface NoteItemProps {
    label: string;
    actualPath: string;
    isDirectory: boolean;
    isEncrypted: boolean;
    displayPath?: string;
}

// ============================================================================
// Command Types
// ============================================================================

/**
 * Callback for when a file is moved or deleted
 */
export type FileOperationCallback = (oldPath: string) => void;

/**
 * Dependencies injected into command handlers
 */
export interface CommandDependencies {
    getBaseDirectory: () => string | undefined;
    refresh: () => void;
    onFileMovedOrDeleted?: FileOperationCallback;
}

// ============================================================================
// Event Types
// ============================================================================

/**
 * Event emitted when encryption state changes
 */
export interface EncryptionStateChangeEvent {
    isUnlocked: boolean;
    timestamp: Date;
}

/**
 * Event emitted when a temp file is created/closed
 */
export interface TempFileEvent {
    type: 'created' | 'closed' | 'saved';
    tempPath: string;
    encryptedPath: string;
    timestamp: Date;
}

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Full extension configuration
 */
export interface SecureNotesConfig {
    baseDirectory: string;
    encryption: EncryptionConfig;
}

/**
 * Get encryption configuration from VS Code settings
 */
export function getEncryptionConfig(): EncryptionConfig {
    const config = vscode.workspace.getConfiguration('secureNotes');
    return {
        publicKeyPath: config.get<string>('encryption.publicKeyPath', ''),
        privateKeyPath: config.get<string>('encryption.privateKeyPath', ''),
        sessionTimeoutMinutes: config.get<number>('encryption.sessionTimeoutMinutes', 30)
    };
}

/**
 * Get the base directory from VS Code settings.
 */
export function getBaseDirectory(): string | undefined {
    const config = vscode.workspace.getConfiguration('secureNotes');
    const baseDir = config.get<string>('baseDirectory');
    return baseDir && baseDir.trim() !== '' ? baseDir.trim() : undefined;
}

