/**
 * TypeScript interfaces and types for SecureNotes extension
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

/** 
 * Dedicated subfolder name for notes storage.
 * This prevents accidental encryption of user files outside the notes directory.
 * SECURITY: This is enforced both when setting and when reading the base directory.
 */
export const NOTES_SUBFOLDER = 'VscodeSecureNotes';

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
    enabled: boolean;
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
        enabled: config.get<boolean>('encryption.enabled', false),
        publicKeyPath: config.get<string>('encryption.publicKeyPath', ''),
        privateKeyPath: config.get<string>('encryption.privateKeyPath', ''),
        sessionTimeoutMinutes: config.get<number>('encryption.sessionTimeoutMinutes', 30)
    };
}

/**
 * Get the base directory from VS Code settings.
 * 
 * SECURITY: Always enforces the VscodeSecureNotes subfolder. If the configured
 * path doesn't end with the subfolder, it's automatically appended. This
 * prevents users from bypassing the protection by manually editing settings.
 */
export function getBaseDirectory(): string | undefined {
    const config = vscode.workspace.getConfiguration('secureNotes');
    const baseDir = config.get<string>('baseDirectory');
    
    if (!baseDir || baseDir.trim() === '') {
        return undefined;
    }
    
    // SECURITY: Always enforce the VscodeSecureNotes subfolder
    // This prevents users from bypassing protection by editing settings directly
    const trimmedPath = baseDir.trim();
    
    // Check if path already ends with the subfolder
    if (path.basename(trimmedPath) === NOTES_SUBFOLDER) {
        // Already has the subfolder, ensure directory exists
        if (!fs.existsSync(trimmedPath)) {
            try {
                fs.mkdirSync(trimmedPath, { recursive: true });
            } catch {
                // Will be handled by caller when they try to use the directory
            }
        }
        return trimmedPath;
    }
    
    // Append the subfolder
    const securePath = path.join(trimmedPath, NOTES_SUBFOLDER);
    
    // Create the directory if it doesn't exist
    if (!fs.existsSync(securePath)) {
        try {
            fs.mkdirSync(securePath, { recursive: true });
        } catch {
            // Will be handled by caller when they try to use the directory
        }
    }
    
    return securePath;
}

