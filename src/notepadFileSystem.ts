import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { DocumentStore } from './documentStore';

/**
 * Virtual file system provider for the notepad:// scheme.
 * Routes all file operations through the DocumentStore to keep
 * decrypted content in memory only.
 */
export class NotepadFileSystem implements vscode.FileSystemProvider {
    private _onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    readonly onDidChangeFile = this._onDidChangeFile.event;

    constructor(private documentStore: DocumentStore) {
        // Forward document store changes to file system events
        documentStore.onDidChange(encryptedPath => {
            const uri = this.getVirtualUri(encryptedPath);
            this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Changed, uri }]);
        });
    }

    /**
     * Convert encrypted file path to virtual URI
     */
    getVirtualUri(encryptedPath: string): vscode.Uri {
        // Remove .enc extension for the virtual path
        const virtualPath = encryptedPath.replace(/\.enc$/, '');
        return vscode.Uri.parse(`notepad://${virtualPath}`);
    }

    /**
     * Convert virtual URI back to encrypted file path
     */
    getEncryptedPath(uri: vscode.Uri): string {
        return uri.path + '.enc';
    }

    watch(_uri: vscode.Uri, _options: { recursive: boolean; excludes: string[] }): vscode.Disposable {
        // We handle watching through the document store
        return new vscode.Disposable(() => {});
    }

    async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
        const encryptedPath = this.getEncryptedPath(uri);

        if (!fs.existsSync(encryptedPath)) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }

        const stats = fs.statSync(encryptedPath);

        return {
            type: stats.isDirectory() ? vscode.FileType.Directory : vscode.FileType.File,
            ctime: stats.ctimeMs,
            mtime: stats.mtimeMs,
            size: stats.size
        };
    }

    async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
        const dirPath = uri.path;
        const entries: [string, vscode.FileType][] = [];

        if (!fs.existsSync(dirPath)) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }

        const dirEntries = fs.readdirSync(dirPath, { withFileTypes: true });

        for (const entry of dirEntries) {
            if (entry.name.startsWith('.')) {
                continue; // Skip hidden files
            }

            if (entry.isDirectory()) {
                entries.push([entry.name, vscode.FileType.Directory]);
            } else if (entry.name.endsWith('.enc')) {
                // Show without .enc extension
                const displayName = entry.name.replace(/\.enc$/, '');
                entries.push([displayName, vscode.FileType.File]);
            }
        }

        return entries;
    }

    async createDirectory(uri: vscode.Uri): Promise<void> {
        const dirPath = uri.path;
        fs.mkdirSync(dirPath, { recursive: true });
    }

    async readFile(uri: vscode.Uri): Promise<Uint8Array> {
        const encryptedPath = this.getEncryptedPath(uri);

        if (!fs.existsSync(encryptedPath)) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }

        try {
            // Open (decrypt) the file and return content from memory
            const content = await this.documentStore.open(encryptedPath);
            return new Uint8Array(content);
        } catch (error) {
            throw vscode.FileSystemError.Unavailable(`Failed to decrypt: ${(error as Error).message}`);
        }
    }

    async writeFile(
        uri: vscode.Uri,
        content: Uint8Array,
        options: { create: boolean; overwrite: boolean }
    ): Promise<void> {
        const encryptedPath = this.getEncryptedPath(uri);
        const exists = fs.existsSync(encryptedPath);

        if (!exists && !options.create) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }

        if (exists && !options.overwrite) {
            throw vscode.FileSystemError.FileExists(uri);
        }

        const buffer = Buffer.from(content);

        if (!exists) {
            // Create new encrypted file
            await this.documentStore.create(encryptedPath, buffer);
        } else {
            // Update existing document in memory and save
            this.documentStore.update(encryptedPath, buffer);
            await this.documentStore.save(encryptedPath);
        }

        this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Changed, uri }]);
    }

    async delete(uri: vscode.Uri, _options: { recursive: boolean }): Promise<void> {
        const encryptedPath = this.getEncryptedPath(uri);

        if (!fs.existsSync(encryptedPath)) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }

        await this.documentStore.delete(encryptedPath);
        this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Deleted, uri }]);
    }

    async rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean }): Promise<void> {
        const oldPath = this.getEncryptedPath(oldUri);
        const newPath = this.getEncryptedPath(newUri);

        if (!fs.existsSync(oldPath)) {
            throw vscode.FileSystemError.FileNotFound(oldUri);
        }

        if (fs.existsSync(newPath) && !options.overwrite) {
            throw vscode.FileSystemError.FileExists(newUri);
        }

        await this.documentStore.rename(oldPath, newPath);

        this._onDidChangeFile.fire([
            { type: vscode.FileChangeType.Deleted, uri: oldUri },
            { type: vscode.FileChangeType.Created, uri: newUri }
        ]);
    }

    dispose(): void {
        this._onDidChangeFile.dispose();
    }
}


