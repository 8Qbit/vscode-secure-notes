/**
 * Tree view item for SecureNotes extension
 * 
 * Represents a file or folder in the notes tree view.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { NoteItemProps, TreeItemType } from './types';

/**
 * Represents a file or folder in the SecureNotes tree view
 */
export class NoteItem extends vscode.TreeItem {
    /** The actual file system path (including .enc for encrypted files) */
    public readonly actualPath: string;
    
    /** Whether this item is a directory */
    public readonly isDirectory: boolean;
    
    /** Whether this is an encrypted file */
    public readonly isEncrypted: boolean;

    constructor(props: NoteItemProps) {
        const collapsibleState = props.isDirectory
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None;

        super(props.label, collapsibleState);

        this.actualPath = props.actualPath;
        this.isDirectory = props.isDirectory;
        this.isEncrypted = props.isEncrypted;

        // Set resource URI for icon determination
        this.resourceUri = props.displayPath
            ? vscode.Uri.file(props.displayPath)
            : vscode.Uri.file(props.actualPath);

        // Set tooltip
        this.tooltip = props.isEncrypted
            ? `${props.actualPath} (encrypted)`
            : props.actualPath;

        // Set context value and command based on type
        this.setupContextAndCommand(props);
    }

    /**
     * Get the type of this tree item
     */
    get type(): TreeItemType {
        if (this.isDirectory) {
            return 'folder';
        }
        return this.isEncrypted ? 'encryptedFile' : 'file';
    }

    /**
     * Set up context value and command based on item type
     */
    private setupContextAndCommand(props: NoteItemProps): void {
        if (props.isDirectory) {
            this.contextValue = 'folder';
            // No command for folders - they expand/collapse
        } else if (props.isEncrypted) {
            this.contextValue = 'encryptedFile';
            this.description = '🔒';
            this.command = {
                command: 'secureNotes.openEncrypted',
                title: 'Open Encrypted Note',
                arguments: [vscode.Uri.file(props.actualPath)]
            };
        } else {
            this.contextValue = 'file';
            this.command = {
                command: 'vscode.open',
                title: 'Open Note',
                arguments: [this.resourceUri]
            };
        }
    }

    /**
     * Create a NoteItem from a file system path
     */
    static fromPath(filePath: string, isDirectory: boolean): NoteItem {
        const fileName = path.basename(filePath);
        const isEncrypted = !isDirectory && fileName.endsWith('.enc');

        // For encrypted files, show the name without .enc suffix
        let displayName = fileName;
        let displayPath: string | undefined;

        if (isEncrypted) {
            displayName = fileName.replace(/\.enc$/, '');
            // Use path without .enc for icon determination
            displayPath = path.join(path.dirname(filePath), displayName);
        }

        return new NoteItem({
            label: displayName,
            actualPath: filePath,
            isDirectory,
            isEncrypted,
            displayPath
        });
    }

    /**
     * Create a NoteItem for a new encrypted file
     */
    static forEncryptedFile(filePath: string, displayName: string): NoteItem {
        const dir = path.dirname(filePath);
        
        return new NoteItem({
            label: displayName,
            actualPath: filePath,
            isDirectory: false,
            isEncrypted: true,
            displayPath: path.join(dir, displayName)
        });
    }
}
