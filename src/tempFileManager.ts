/**
 * Temporary File Manager for SecureNotes extension
 * 
 * Manages decrypted files in /dev/shm (RAM-based storage) for secure editing.
 * Files are decrypted to temp storage, edited with native VS Code editor,
 * and re-encrypted on save.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { NotepadEncryption } from './encryption';
import { TempFileState } from './types';
import { tempFileLogger as logger } from './logger';
import { DecryptionFailedError } from './errors';
import {
    secureDelete,
    secureWriteFile,
    createSecureDirectory,
    createDebouncedFileHandler,
    SECURE_FILE_PERMISSIONS
} from './fileUtils';

/** Base path for secure temp files */
const TEMP_BASE_PATH = '/dev/shm';

/** Debounce delay for file save events (ms) */
const SAVE_DEBOUNCE_MS = 100;

/**
 * Manages temporary decrypted files in /dev/shm for secure editing.
 * 
 * Features:
 * - Decrypts files to RAM-based storage
 * - Watches for changes and re-encrypts on save
 * - Securely deletes temp files on close
 * - Handles file moves and renames
 */
export class TempFileManager implements vscode.Disposable {
    private readonly tempDir: string;
    private readonly sessionId: string;
    private readonly tempFiles: Map<string, TempFileState> = new Map();
    private readonly saveInProgress: Set<string> = new Set();
    private readonly disposables: vscode.Disposable[] = [];
    private readonly debouncedSave: (tempPath: string) => void;

    constructor(private readonly encryption: NotepadEncryption) {
        // Generate unique session ID
        this.sessionId = crypto.randomBytes(8).toString('hex');
        this.tempDir = path.join(TEMP_BASE_PATH, `secureNotes-${this.sessionId}`);

        // Create temp directory with secure permissions
        createSecureDirectory(this.tempDir, SECURE_FILE_PERMISSIONS.PRIVATE_DIR);

        // Set up debounced save handler
        this.debouncedSave = createDebouncedFileHandler(
            (tempPath) => this.handleFileChange(tempPath),
            SAVE_DEBOUNCE_MS
        );

        // Watch for document save events (more reliable than file watcher)
        this.disposables.push(
            vscode.workspace.onDidSaveTextDocument(doc => {
                const tempPath = doc.uri.fsPath;
                if (this.tempFiles.has(tempPath)) {
                    // Trigger immediate re-encrypt on save (bypass debounce)
                    this.handleFileChange(tempPath);
                }
            })
        );

        // Watch for tab close events
        this.disposables.push(
            vscode.window.tabGroups.onDidChangeTabs(event => {
                this.handleTabsChanged(event);
            })
        );

        // Watch for document close events (backup)
        this.disposables.push(
            vscode.workspace.onDidCloseTextDocument(doc => {
                this.handleDocumentClosed(doc);
            })
        );

        logger.info('TempFileManager initialized', {
            tempDir: this.tempDir,
            sessionId: this.sessionId
        });
    }

    // ========================================================================
    // Static Methods
    // ========================================================================

    /**
     * Check if /dev/shm is available (Linux only)
     */
    static isAvailable(): boolean {
        const available = fs.existsSync(TEMP_BASE_PATH) && process.platform === 'linux';
        logger.debug('Checking temp storage availability', { available, platform: process.platform });
        return available;
    }

    // ========================================================================
    // Public API
    // ========================================================================

    /**
     * Open an encrypted file by decrypting it to temp and opening with native editor
     */
    async openEncryptedFile(encryptedPath: string): Promise<void> {
        // Check if already open
        const existingState = this.findByEncryptedPath(encryptedPath);
        if (existingState) {
            logger.debug('File already open, focusing', { encryptedPath });
            await this.focusFile(existingState.tempPath);
            return;
        }

        // Ensure encryption is unlocked
        if (!this.encryption.getIsUnlocked()) {
            const unlocked = await this.encryption.unlock();
            if (!unlocked) {
                return;
            }
        }

        try {
            // Decrypt the file
            const decryptedContent = this.encryption.decryptFile(encryptedPath);

            // Create unique temp file path
            const tempPath = this.createTempPath(encryptedPath);

            // Write decrypted content with secure permissions
            secureWriteFile(tempPath, decryptedContent, SECURE_FILE_PERMISSIONS.PRIVATE);

            // Set up tracking and watcher
            const watcher = this.createFileWatcher(tempPath, encryptedPath);
            
            this.tempFiles.set(tempPath, {
                tempPath,
                encryptedPath,
                watcher,
                lastModified: new Date()
            });

            // Open in native VS Code editor
            await this.focusFile(tempPath);

            logger.info('Opened encrypted file', {
                encryptedPath,
                tempPath
            });
        } catch (error) {
            logger.error('Failed to open encrypted file', error as Error, { encryptedPath });
            
            if (error instanceof DecryptionFailedError) {
                error.showError();
            } else {
                vscode.window.showErrorMessage(
                    `Failed to open encrypted file: ${(error as Error).message}`
                );
            }
        }
    }

    /**
     * Create a new encrypted file
     */
    async createEncryptedFile(encryptedPath: string): Promise<void> {
        // Ensure encryption is unlocked
        if (!this.encryption.getIsUnlocked()) {
            const unlocked = await this.encryption.unlock();
            if (!unlocked) {
                return;
            }
        }

        try {
            // Create empty encrypted file with secure permissions
            const emptyContent = Buffer.from('');
            const encrypted = this.encryption.encrypt(emptyContent);
            fs.writeFileSync(encryptedPath, JSON.stringify(encrypted, null, 2), { mode: 0o600 });

            logger.info('Created new encrypted file', { encryptedPath });

            // Now open it
            await this.openEncryptedFile(encryptedPath);
        } catch (error) {
            logger.error('Failed to create encrypted file', error as Error, { encryptedPath });
            vscode.window.showErrorMessage(
                `Failed to create encrypted file: ${(error as Error).message}`
            );
        }
    }

    /**
     * Check if a temp file is currently open for an encrypted file
     */
    isOpen(encryptedPath: string): boolean {
        return this.findByEncryptedPath(encryptedPath) !== undefined;
    }

    /**
     * Get the temp path for an encrypted file (if open)
     */
    getTempPath(encryptedPath: string): string | undefined {
        return this.findByEncryptedPath(encryptedPath)?.tempPath;
    }

    /**
     * Handle when an encrypted file is moved, renamed, or deleted.
     * Closes the temp file if it was open.
     */
    onFileMovedOrDeleted(oldEncryptedPath: string): void {
        const state = this.findByEncryptedPath(oldEncryptedPath);
        if (!state) {
            return;
        }

        logger.info('Handling moved/deleted file', { oldEncryptedPath });

        // Close any editors showing this temp file
        this.closeEditorTabs(state.tempPath);

        // Use async cleanup to ensure pending saves complete first
        this.cleanupTempFileAsync(state.tempPath);
    }

    /**
     * Check if an encrypted file is open with unsaved changes.
     */
    isOpenWithUnsavedChanges(encryptedPath: string): boolean {
        const state = this.findByEncryptedPath(encryptedPath);
        if (!state) {
            return false;
        }
        
        const doc = vscode.workspace.textDocuments.find(d => d.uri.fsPath === state.tempPath);
        return doc?.isDirty ?? false;
    }

    /**
     * Save any pending changes and close the temp file for an encrypted file.
     * Use this BEFORE moving/renaming an encrypted file to prevent data loss.
     * 
     * @returns true if save was successful or file wasn't open, false on error
     */
    async saveAndCloseBeforeMove(encryptedPath: string): Promise<boolean> {
        const state = this.findByEncryptedPath(encryptedPath);
        if (!state) {
            return true; // Not open, nothing to do
        }

        logger.info('Saving and closing before move', { encryptedPath, tempPath: state.tempPath });

        try {
            // Find the document
            const doc = vscode.workspace.textDocuments.find(d => d.uri.fsPath === state.tempPath);
            
            // If document is dirty, save it first
            if (doc && doc.isDirty) {
                await doc.save();
                // Wait a moment for save to complete
                await new Promise(resolve => setTimeout(resolve, 100));
            }

            // Force final re-encrypt to ensure latest content is saved
            if (fs.existsSync(state.tempPath)) {
                await this.reEncryptFile(state.tempPath, state.encryptedPath);
            }

            // Close any editors showing this temp file
            this.closeEditorTabs(state.tempPath);

            // Clean up without trying to re-encrypt again
            state.watcher.dispose();
            secureDelete(state.tempPath);
            this.tempFiles.delete(state.tempPath);

            logger.info('Successfully saved and closed before move', { encryptedPath });
            return true;
        } catch (error) {
            logger.error('Failed to save before move', error as Error, { encryptedPath });
            vscode.window.showErrorMessage(
                `Failed to save changes before moving: ${(error as Error).message}`
            );
            return false;
        }
    }

    // ========================================================================
    // Private Methods - File Operations
    // ========================================================================

    /**
     * Create a unique temp file path for an encrypted file
     */
    private createTempPath(encryptedPath: string): string {
        const fileName = path.basename(encryptedPath).replace(/\.enc$/, '');
        const pathHash = crypto.createHash('md5')
            .update(encryptedPath)
            .digest('hex')
            .slice(0, 8);
        
        return path.join(this.tempDir, `${pathHash}_${fileName}`);
    }

    /**
     * Find temp file state by encrypted path
     */
    private findByEncryptedPath(encryptedPath: string): TempFileState | undefined {
        for (const state of this.tempFiles.values()) {
            if (state.encryptedPath === encryptedPath) {
                return state;
            }
        }
        return undefined;
    }

    /**
     * Focus a temp file in the editor
     */
    private async focusFile(tempPath: string): Promise<void> {
        const doc = await vscode.workspace.openTextDocument(tempPath);
        await vscode.window.showTextDocument(doc);
    }

    /**
     * Create a file watcher for a temp file
     */
    private createFileWatcher(tempPath: string, _encryptedPath: string): vscode.FileSystemWatcher {
        const pattern = new vscode.RelativePattern(
            path.dirname(tempPath),
            path.basename(tempPath)
        );
        
        const watcher = vscode.workspace.createFileSystemWatcher(pattern);

        watcher.onDidChange(() => {
            this.debouncedSave(tempPath);
        });

        return watcher;
    }

    /**
     * Handle file change (debounced)
     */
    private async handleFileChange(tempPath: string): Promise<void> {
        if (this.saveInProgress.has(tempPath)) {
            return;
        }

        const state = this.tempFiles.get(tempPath);
        if (!state) {
            return;
        }

        this.saveInProgress.add(tempPath);
        
        try {
            await this.reEncryptFile(tempPath, state.encryptedPath);
            state.lastModified = new Date();
        } finally {
            this.saveInProgress.delete(tempPath);
        }
    }

    /**
     * Re-encrypt a temp file back to its encrypted location
     */
    private async reEncryptFile(tempPath: string, encryptedPath: string): Promise<void> {
        try {
            await this.encryption.encryptFile(tempPath, encryptedPath);
            logger.debug('Re-encrypted file', { tempPath, encryptedPath });
        } catch (error) {
            logger.error('Failed to re-encrypt file', error as Error, { tempPath, encryptedPath });
            vscode.window.showErrorMessage(
                `Failed to save encrypted file: ${(error as Error).message}`
            );
        }
    }

    // ========================================================================
    // Private Methods - Event Handlers
    // ========================================================================

    /**
     * Handle tab changes - clean up temp files for closed tabs
     */
    private handleTabsChanged(event: vscode.TabChangeEvent): void {
        for (const closedTab of event.closed) {
            if (closedTab.input instanceof vscode.TabInputText) {
                const uri = closedTab.input.uri;
                if (this.tempFiles.has(uri.fsPath)) {
                    logger.debug('Tab closed, cleaning up', { tempPath: uri.fsPath });
                    // Use async cleanup to ensure save completes first
                    this.cleanupTempFileAsync(uri.fsPath);
                }
            }
        }
    }

    /**
     * Handle document close - clean up temp file (backup handler)
     */
    private handleDocumentClosed(doc: vscode.TextDocument): void {
        const tempPath = doc.uri.fsPath;
        
        if (!this.tempFiles.has(tempPath)) {
            return;
        }

        // Delay cleanup slightly to allow tab handler to run first
        setTimeout(() => {
            if (this.tempFiles.has(tempPath)) {
                logger.debug('Document closed, cleaning up', { tempPath });
                this.cleanupTempFileAsync(tempPath);
            }
        }, 100);
    }

    /**
     * Close editor tabs showing a specific temp file
     */
    private closeEditorTabs(tempPath: string): void {
        vscode.window.tabGroups.all.forEach(group => {
            group.tabs.forEach(tab => {
                if (tab.input instanceof vscode.TabInputText) {
                    if (tab.input.uri.fsPath === tempPath) {
                        vscode.window.tabGroups.close(tab);
                    }
                }
            });
        });
    }

    // ========================================================================
    // Private Methods - Cleanup
    // ========================================================================

    /**
     * Clean up a temp file asynchronously - ensures pending saves complete first.
     * 
     * CRITICAL: This prevents data loss by flushing any pending saves before cleanup.
     */
    private async cleanupTempFileAsync(tempPath: string): Promise<void> {
        const state = this.tempFiles.get(tempPath);
        if (!state) {
            return;
        }

        // Wait for any in-progress save to complete
        if (this.saveInProgress.has(tempPath)) {
            logger.debug('Waiting for in-progress save before cleanup', { tempPath });
            // Wait a bit for save to complete
            await new Promise(resolve => setTimeout(resolve, 200));
        }

        // Force final re-encrypt to ensure latest content is saved
        // This handles the race condition where debounced save hasn't run yet
        if (fs.existsSync(tempPath)) {
            try {
                logger.debug('Final save before cleanup', { tempPath });
                await this.reEncryptFile(tempPath, state.encryptedPath);
            } catch (error) {
                logger.error('Failed final save before cleanup', error as Error, { tempPath });
                // Continue with cleanup even if save fails - user was warned
            }
        }

        // Now perform cleanup
        this.cleanupTempFile(tempPath);
    }

    /**
     * Clean up a temp file synchronously - use cleanupTempFileAsync when possible
     * to prevent data loss.
     */
    private cleanupTempFile(tempPath: string): void {
        const state = this.tempFiles.get(tempPath);
        if (!state) {
            return;
        }

        // Dispose watcher
        state.watcher.dispose();

        // Securely delete temp file
        secureDelete(tempPath);

        // Remove from tracking
        this.tempFiles.delete(tempPath);

        logger.info('Cleaned up temp file', { 
            tempPath, 
            encryptedPath: state.encryptedPath 
        });
    }

    // ========================================================================
    // Disposal
    // ========================================================================

    /**
     * Clean up all temp files and the temp directory
     */
    dispose(): void {
        logger.info('Disposing TempFileManager');

        // Dispose all disposables
        for (const d of this.disposables) {
            d.dispose();
        }

        // Clean up all temp files
        for (const state of this.tempFiles.values()) {
            state.watcher.dispose();
            secureDelete(state.tempPath);
        }
        this.tempFiles.clear();

        // Remove temp directory
        try {
            if (fs.existsSync(this.tempDir)) {
                fs.rmSync(this.tempDir, { recursive: true, force: true });
            }
        } catch (error) {
            logger.error('Failed to remove temp directory', error as Error, { tempDir: this.tempDir });
        }

        logger.info('TempFileManager disposed');
    }
}
