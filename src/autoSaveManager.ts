/**
 * AutoSave Manager for SecureNotes extension
 * 
 * Provides inactivity-based automatic saving of notes.
 * Documents are saved after a configurable period of no input (default: 5 seconds).
 * 
 * Only saves documents within the SecureNotes base directory.
 * Works with both encrypted (temp files) and plain text notes.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { logger } from './logger';

const autoSaveLogger = logger.child('AutoSave');

/** Configuration interface for autosave settings */
interface AutoSaveConfig {
    enabled: boolean;
    delaySeconds: number;
}

/**
 * Manages inactivity-based automatic saving of documents within the SecureNotes directory.
 * 
 * Features:
 * - Saves documents after a configurable period of inactivity
 * - Per-document timers ensure each document is saved independently
 * - Respects base directory boundaries
 * - Dynamically updates when configuration changes
 */
export class AutoSaveManager implements vscode.Disposable {
    private readonly disposables: vscode.Disposable[] = [];
    private readonly pendingSaves: Map<string, NodeJS.Timeout> = new Map();
    private config: AutoSaveConfig;

    /**
     * Create an AutoSaveManager
     * @param getBaseDirectory Callback to get the current notes base directory
     * @param getTempFilePaths Optional callback to get paths of temp files (for encrypted file support)
     */
    constructor(
        private readonly getBaseDirectory: () => string | undefined,
        private readonly getTempFilePaths?: () => string[]
    ) {
        // Load initial configuration
        this.config = this.loadConfig();

        // Watch for configuration changes
        this.disposables.push(
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('secureNotes.autosave')) {
                    this.handleConfigChange();
                }
            })
        );

        // Listen for document changes to trigger autosave
        this.disposables.push(
            vscode.workspace.onDidChangeTextDocument(e => {
                this.handleDocumentChange(e.document);
            })
        );

        // Clean up pending saves when documents are closed
        this.disposables.push(
            vscode.workspace.onDidCloseTextDocument(doc => {
                this.cancelPendingSave(doc.uri.fsPath);
            })
        );

        // Clean up pending saves when documents are saved manually
        this.disposables.push(
            vscode.workspace.onDidSaveTextDocument(doc => {
                this.cancelPendingSave(doc.uri.fsPath);
            })
        );

        autoSaveLogger.info('AutoSaveManager initialized', {
            enabled: this.config.enabled,
            delaySeconds: this.config.delaySeconds
        });
    }

    // ========================================================================
    // Configuration
    // ========================================================================

    /**
     * Load autosave configuration from VS Code settings
     */
    private loadConfig(): AutoSaveConfig {
        const config = vscode.workspace.getConfiguration('secureNotes.autosave');
        return {
            enabled: config.get<boolean>('enabled', true),
            delaySeconds: config.get<number>('delaySeconds', 5)
        };
    }

    /**
     * Handle configuration changes
     */
    private handleConfigChange(): void {
        this.config = this.loadConfig();

        autoSaveLogger.info('Configuration changed', {
            enabled: this.config.enabled,
            delaySeconds: this.config.delaySeconds
        });

        // If disabled, cancel all pending saves
        if (!this.config.enabled) {
            this.cancelAllPendingSaves();
        }
    }

    // ========================================================================
    // Inactivity-based Autosave
    // ========================================================================

    /**
     * Handle document changes - schedule autosave after inactivity period
     */
    private handleDocumentChange(document: vscode.TextDocument): void {
        if (!this.config.enabled) {
            return;
        }

        // Skip untitled documents
        if (document.isUntitled) {
            return;
        }

        // Check if document is within notes directory
        if (!this.isDocumentInNotesDirectory(document)) {
            return;
        }

        const docPath = document.uri.fsPath;

        // Cancel any existing pending save for this document
        this.cancelPendingSave(docPath);

        // Schedule a new save after the inactivity delay
        const delayMs = this.config.delaySeconds * 1000;
        const timeout = setTimeout(async () => {
            this.pendingSaves.delete(docPath);
            await this.saveDocument(document);
        }, delayMs);

        this.pendingSaves.set(docPath, timeout);
        
        autoSaveLogger.debug('Scheduled autosave', { 
            path: docPath, 
            delayMs 
        });
    }

    /**
     * Save a document
     */
    private async saveDocument(document: vscode.TextDocument): Promise<void> {
        // Check if document is still dirty and not closed
        if (!document.isDirty || document.isClosed) {
            return;
        }

        try {
            await document.save();
            autoSaveLogger.debug('Autosaved document', { 
                path: document.uri.fsPath 
            });
        } catch (error) {
            autoSaveLogger.error('Failed to autosave document', error as Error, {
                path: document.uri.fsPath
            });
        }
    }

    /**
     * Cancel a pending save for a specific document
     */
    private cancelPendingSave(docPath: string): void {
        const timeout = this.pendingSaves.get(docPath);
        if (timeout) {
            clearTimeout(timeout);
            this.pendingSaves.delete(docPath);
        }
    }

    /**
     * Cancel all pending saves
     */
    private cancelAllPendingSaves(): void {
        for (const timeout of this.pendingSaves.values()) {
            clearTimeout(timeout);
        }
        this.pendingSaves.clear();
        autoSaveLogger.debug('Cancelled all pending saves');
    }

    /**
     * Check if a document is within the notes directory or is a temp file for an encrypted note
     */
    private isDocumentInNotesDirectory(document: vscode.TextDocument): boolean {
        const docPath = document.uri.fsPath;
        
        // Check if it's a temp file for an encrypted note
        if (this.getTempFilePaths) {
            const tempPaths = this.getTempFilePaths();
            if (tempPaths.includes(docPath)) {
                return true;
            }
        }

        // Check if it's in the base notes directory
        const baseDir = this.getBaseDirectory();
        if (!baseDir) {
            return false;
        }

        // Simple prefix check - the document path should start with the base directory
        const normalizedDoc = path.normalize(docPath);
        const normalizedBase = path.normalize(baseDir);
        
        return normalizedDoc.startsWith(normalizedBase + path.sep) || 
               normalizedDoc === normalizedBase;
    }

    // ========================================================================
    // Public API
    // ========================================================================

    /**
     * Check if autosave is currently enabled
     */
    isEnabled(): boolean {
        return this.config.enabled;
    }

    /**
     * Get the current autosave delay in seconds
     */
    getDelaySeconds(): number {
        return this.config.delaySeconds;
    }

    // ========================================================================
    // Disposal
    // ========================================================================

    /**
     * Clean up resources
     */
    dispose(): void {
        autoSaveLogger.info('Disposing AutoSaveManager');

        // Cancel all pending saves
        this.cancelAllPendingSaves();

        // Dispose all disposables
        for (const d of this.disposables) {
            d.dispose();
        }

        autoSaveLogger.info('AutoSaveManager disposed');
    }
}
