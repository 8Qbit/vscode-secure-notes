import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { NotepadEncryption } from './encryption';

/**
 * Manages temporary decrypted files in /dev/shm for secure editing.
 * Files are decrypted to RAM-based storage, edited with native VS Code editor,
 * and re-encrypted on save.
 */
export class TempFileManager implements vscode.Disposable {
    private tempDir: string;
    private fileWatchers: Map<string, vscode.FileSystemWatcher> = new Map();
    private tempToEncrypted: Map<string, string> = new Map(); // temp path -> encrypted path
    private encryptedToTemp: Map<string, string> = new Map(); // encrypted path -> temp path
    private saveInProgress: Set<string> = new Set(); // Prevent re-encryption loops
    private disposables: vscode.Disposable[] = [];

    constructor(private encryption: NotepadEncryption) {
        // Create unique session directory in /dev/shm
        const sessionId = crypto.randomBytes(8).toString('hex');
        this.tempDir = `/dev/shm/secureNotes-${sessionId}`;
        
        // Create the temp directory
        if (!fs.existsSync(this.tempDir)) {
            fs.mkdirSync(this.tempDir, { recursive: true, mode: 0o700 });
        }

        // Watch for editor close events to clean up temp files
        this.disposables.push(
            vscode.workspace.onDidCloseTextDocument(doc => {
                this.onDocumentClosed(doc);
            })
        );

        // Also watch for tab close events - more reliable than onDidCloseTextDocument
        this.disposables.push(
            vscode.window.tabGroups.onDidChangeTabs(event => {
                this.onTabsChanged(event);
            })
        );

        console.log(`TempFileManager: Created temp directory at ${this.tempDir}`);
    }

    /**
     * Check if /dev/shm is available (Linux)
     */
    static isAvailable(): boolean {
        return fs.existsSync('/dev/shm') && process.platform === 'linux';
    }

    /**
     * Open an encrypted file by decrypting it to temp and opening with native editor
     */
    async openEncryptedFile(encryptedPath: string): Promise<void> {
        // Check if already open
        if (this.encryptedToTemp.has(encryptedPath)) {
            const tempPath = this.encryptedToTemp.get(encryptedPath)!;
            const doc = await vscode.workspace.openTextDocument(tempPath);
            await vscode.window.showTextDocument(doc);
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

            // Create temp file path with unique hash to avoid conflicts
            // Use hash of full path to ensure uniqueness even for same-named files in different dirs
            const fileName = path.basename(encryptedPath).replace(/\.enc$/, '');
            const pathHash = crypto.createHash('md5').update(encryptedPath).digest('hex').slice(0, 8);
            const uniqueFileName = `${pathHash}_${fileName}`;
            const tempPath = path.join(this.tempDir, uniqueFileName);

            // Write decrypted content to temp file with restrictive permissions
            fs.writeFileSync(tempPath, decryptedContent, { mode: 0o600 });

            // Track the mapping
            this.tempToEncrypted.set(tempPath, encryptedPath);
            this.encryptedToTemp.set(encryptedPath, tempPath);

            // Set up file watcher for this temp file
            this.setupFileWatcher(tempPath, encryptedPath);

            // Open in native VS Code editor
            const doc = await vscode.workspace.openTextDocument(tempPath);
            await vscode.window.showTextDocument(doc);

            console.log(`TempFileManager: Opened ${encryptedPath} -> ${tempPath}`);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to open encrypted file: ${(error as Error).message}`);
        }
    }

    /**
     * Set up a file watcher to re-encrypt when temp file is saved
     */
    private setupFileWatcher(tempPath: string, encryptedPath: string): void {
        // Watch for changes to this specific temp file
        const watcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(path.dirname(tempPath), path.basename(tempPath))
        );

        watcher.onDidChange(async (uri) => {
            if (this.saveInProgress.has(tempPath)) {
                return; // Skip if we're in the middle of a save
            }

            this.saveInProgress.add(tempPath);
            try {
                await this.reEncryptFile(tempPath, encryptedPath);
            } finally {
                this.saveInProgress.delete(tempPath);
            }
        });

        this.fileWatchers.set(tempPath, watcher);
    }

    /**
     * Re-encrypt a temp file back to its encrypted location
     */
    private async reEncryptFile(tempPath: string, encryptedPath: string): Promise<void> {
        try {
            // Read the current temp file content
            const content = fs.readFileSync(tempPath);

            // Encrypt and write back to original location
            await this.encryption.encryptFile(tempPath, encryptedPath);

            console.log(`TempFileManager: Re-encrypted ${tempPath} -> ${encryptedPath}`);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to save encrypted file: ${(error as Error).message}`);
        }
    }

    /**
     * Handle tab changes - clean up temp files for closed tabs
     */
    private onTabsChanged(event: vscode.TabChangeEvent): void {
        for (const closedTab of event.closed) {
            // Check if this is a text document tab
            if (closedTab.input instanceof vscode.TabInputText) {
                const uri = closedTab.input.uri;
                if (this.tempToEncrypted.has(uri.fsPath)) {
                    this.cleanupTempFile(uri.fsPath);
                }
            }
        }
    }

    /**
     * Handle document close - clean up temp file
     */
    private onDocumentClosed(doc: vscode.TextDocument): void {
        const tempPath = doc.uri.fsPath;
        
        if (!this.tempToEncrypted.has(tempPath)) {
            return; // Not one of our temp files
        }

        this.cleanupTempFile(tempPath);
    }

    /**
     * Clean up a temp file - delete it and remove from tracking
     */
    private cleanupTempFile(tempPath: string): void {
        const encryptedPath = this.tempToEncrypted.get(tempPath);
        if (!encryptedPath) {
            return;
        }

        // Clean up watcher
        const watcher = this.fileWatchers.get(tempPath);
        if (watcher) {
            watcher.dispose();
            this.fileWatchers.delete(tempPath);
        }

        // Delete temp file
        try {
            if (fs.existsSync(tempPath)) {
                // Overwrite with zeros before deleting for extra security
                const stat = fs.statSync(tempPath);
                fs.writeFileSync(tempPath, Buffer.alloc(stat.size, 0));
                fs.unlinkSync(tempPath);
            }
        } catch (error) {
            console.error(`Failed to delete temp file ${tempPath}:`, error);
        }

        // Remove from maps
        this.tempToEncrypted.delete(tempPath);
        this.encryptedToTemp.delete(encryptedPath);

        console.log(`TempFileManager: Cleaned up ${tempPath}`);
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
            // Create empty encrypted file
            const emptyContent = Buffer.from('');
            const encrypted = this.encryption.encrypt(emptyContent);
            fs.writeFileSync(encryptedPath, JSON.stringify(encrypted, null, 2));

            // Now open it
            await this.openEncryptedFile(encryptedPath);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to create encrypted file: ${(error as Error).message}`);
        }
    }

    /**
     * Check if a temp file is currently open for an encrypted file
     */
    isOpen(encryptedPath: string): boolean {
        return this.encryptedToTemp.has(encryptedPath);
    }

    /**
     * Get the temp path for an encrypted file (if open)
     */
    getTempPath(encryptedPath: string): string | undefined {
        return this.encryptedToTemp.get(encryptedPath);
    }

    /**
     * Handle when an encrypted file is moved or renamed.
     * Closes the temp file if it was open.
     */
    onFileMovedOrDeleted(oldEncryptedPath: string): void {
        if (this.encryptedToTemp.has(oldEncryptedPath)) {
            const tempPath = this.encryptedToTemp.get(oldEncryptedPath)!;
            
            // Close any editors showing this temp file
            vscode.window.tabGroups.all.forEach(group => {
                group.tabs.forEach(tab => {
                    if (tab.input instanceof vscode.TabInputText) {
                        if (tab.input.uri.fsPath === tempPath) {
                            vscode.window.tabGroups.close(tab);
                        }
                    }
                });
            });

            // Clean up the temp file
            this.cleanupTempFile(tempPath);
            
            console.log(`TempFileManager: Cleaned up moved/deleted file ${oldEncryptedPath}`);
        }
    }

    /**
     * Clean up all temp files and the temp directory
     */
    dispose(): void {
        console.log('TempFileManager: Disposing...');

        // Dispose all watchers
        for (const watcher of this.fileWatchers.values()) {
            watcher.dispose();
        }
        this.fileWatchers.clear();

        // Dispose other disposables
        for (const d of this.disposables) {
            d.dispose();
        }

        // Delete all temp files securely
        for (const tempPath of this.tempToEncrypted.keys()) {
            try {
                if (fs.existsSync(tempPath)) {
                    const stat = fs.statSync(tempPath);
                    fs.writeFileSync(tempPath, Buffer.alloc(stat.size, 0));
                    fs.unlinkSync(tempPath);
                }
            } catch (error) {
                console.error(`Failed to delete temp file ${tempPath}:`, error);
            }
        }

        // Remove temp directory
        try {
            if (fs.existsSync(this.tempDir)) {
                fs.rmSync(this.tempDir, { recursive: true, force: true });
            }
        } catch (error) {
            console.error(`Failed to remove temp directory ${this.tempDir}:`, error);
        }

        this.tempToEncrypted.clear();
        this.encryptedToTemp.clear();

        console.log('TempFileManager: Disposed');
    }
}

