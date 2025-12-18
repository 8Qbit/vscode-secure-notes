import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { NotepadEncryption, EncryptedFile } from './encryption';

export interface StoredDocument {
    content: Buffer;
    originalPath: string;  // Path to the .enc file on disk
    isDirty: boolean;
    lastModified: number;
}

/**
 * In-memory store for decrypted document content.
 * Decrypted data never touches the disk.
 */
export class DocumentStore implements vscode.Disposable {
    private documents: Map<string, StoredDocument> = new Map();
    private encryption: NotepadEncryption;
    private _onDidChange = new vscode.EventEmitter<string>();
    readonly onDidChange = this._onDidChange.event;

    constructor(encryption: NotepadEncryption) {
        this.encryption = encryption;
    }

    /**
     * Get the virtual URI for a document (notepad:// scheme)
     */
    static getVirtualUri(encryptedPath: string): vscode.Uri {
        // Convert the encrypted file path to a virtual URI
        const relativePath = encryptedPath.replace(/\.enc$/, '');
        return vscode.Uri.parse(`notepad://${relativePath}`);
    }

    /**
     * Get the encrypted file path from a virtual URI
     */
    static getEncryptedPath(uri: vscode.Uri): string {
        return uri.path + '.enc';
    }

    /**
     * Open and decrypt a document, storing it in memory
     */
    async open(encryptedPath: string): Promise<Buffer> {
        const key = this.getKey(encryptedPath);

        // Check if already loaded
        const existing = this.documents.get(key);
        if (existing) {
            return existing.content;
        }

        // Ensure encryption is unlocked
        if (!this.encryption.getIsUnlocked()) {
            const unlocked = await this.encryption.unlock();
            if (!unlocked) {
                throw new Error('Encryption not unlocked');
            }
        }

        // Decrypt the file
        try {
            const content = this.encryption.decryptFile(encryptedPath);
            
            this.documents.set(key, {
                content,
                originalPath: encryptedPath,
                isDirty: false,
                lastModified: Date.now()
            });

            return content;
        } catch (error) {
            throw new Error(`Failed to decrypt file: ${(error as Error).message}`);
        }
    }

    /**
     * Get document content from memory (must be opened first)
     */
    get(encryptedPath: string): Buffer | undefined {
        const key = this.getKey(encryptedPath);
        return this.documents.get(key)?.content;
    }

    /**
     * Update document content in memory
     */
    update(encryptedPath: string, content: Buffer): void {
        const key = this.getKey(encryptedPath);
        const existing = this.documents.get(key);

        if (existing) {
            existing.content = content;
            existing.isDirty = true;
            existing.lastModified = Date.now();
        } else {
            this.documents.set(key, {
                content,
                originalPath: encryptedPath,
                isDirty: true,
                lastModified: Date.now()
            });
        }

        this._onDidChange.fire(encryptedPath);
    }

    /**
     * Save document (encrypt and write to disk)
     */
    async save(encryptedPath: string): Promise<void> {
        const key = this.getKey(encryptedPath);
        const doc = this.documents.get(key);

        if (!doc) {
            throw new Error('Document not found in store');
        }

        if (!this.encryption.getIsUnlocked()) {
            throw new Error('Encryption not unlocked');
        }

        try {
            const encrypted = this.encryption.encrypt(doc.content);
            fs.writeFileSync(encryptedPath, JSON.stringify(encrypted, null, 2));
            doc.isDirty = false;
        } catch (error) {
            throw new Error(`Failed to save encrypted file: ${(error as Error).message}`);
        }
    }

    /**
     * Create a new encrypted document
     */
    async create(encryptedPath: string, content: Buffer = Buffer.from('')): Promise<void> {
        if (!this.encryption.getIsUnlocked()) {
            const unlocked = await this.encryption.unlock();
            if (!unlocked) {
                throw new Error('Encryption not unlocked');
            }
        }

        const key = this.getKey(encryptedPath);

        // Store in memory
        this.documents.set(key, {
            content,
            originalPath: encryptedPath,
            isDirty: true,
            lastModified: Date.now()
        });

        // Encrypt and save to disk
        const encrypted = this.encryption.encrypt(content);
        
        // Ensure directory exists
        const dir = path.dirname(encryptedPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        fs.writeFileSync(encryptedPath, JSON.stringify(encrypted, null, 2));
        
        const doc = this.documents.get(key);
        if (doc) {
            doc.isDirty = false;
        }
    }

    /**
     * Close a document (remove from memory)
     */
    close(encryptedPath: string): void {
        const key = this.getKey(encryptedPath);
        const doc = this.documents.get(key);

        if (doc) {
            // Clear the content buffer
            doc.content.fill(0);
            this.documents.delete(key);
        }
    }

    /**
     * Check if document has unsaved changes
     */
    isDirty(encryptedPath: string): boolean {
        const key = this.getKey(encryptedPath);
        return this.documents.get(key)?.isDirty ?? false;
    }

    /**
     * Check if document is open in memory
     */
    isOpen(encryptedPath: string): boolean {
        const key = this.getKey(encryptedPath);
        return this.documents.has(key);
    }

    /**
     * Get all dirty documents
     */
    getDirtyDocuments(): string[] {
        const dirty: string[] = [];
        for (const [, doc] of this.documents) {
            if (doc.isDirty) {
                dirty.push(doc.originalPath);
            }
        }
        return dirty;
    }

    /**
     * Save all dirty documents
     */
    async saveAll(): Promise<void> {
        const dirty = this.getDirtyDocuments();
        for (const docPath of dirty) {
            await this.save(docPath);
        }
    }

    /**
     * Clear all documents from memory (secure wipe)
     */
    clear(): void {
        for (const [, doc] of this.documents) {
            // Overwrite content buffer with zeros before clearing
            doc.content.fill(0);
        }
        this.documents.clear();
    }

    /**
     * Delete a document from memory and disk
     */
    async delete(encryptedPath: string): Promise<void> {
        this.close(encryptedPath);
        
        if (fs.existsSync(encryptedPath)) {
            fs.unlinkSync(encryptedPath);
        }
    }

    /**
     * Rename a document
     */
    async rename(oldPath: string, newPath: string): Promise<void> {
        const oldKey = this.getKey(oldPath);
        const doc = this.documents.get(oldKey);

        if (doc) {
            // Update in-memory reference
            const newKey = this.getKey(newPath);
            doc.originalPath = newPath;
            this.documents.delete(oldKey);
            this.documents.set(newKey, doc);
        }

        // Rename on disk
        if (fs.existsSync(oldPath)) {
            fs.renameSync(oldPath, newPath);
        }
    }

    private getKey(encryptedPath: string): string {
        return path.normalize(encryptedPath).toLowerCase();
    }

    dispose(): void {
        this.clear();
        this._onDidChange.dispose();
    }
}


