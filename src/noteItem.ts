import * as vscode from 'vscode';
import * as path from 'path';

export class NoteItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly resourceUri: vscode.Uri,
        public readonly isDirectory: boolean,
        public readonly isEncrypted: boolean,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(label, collapsibleState);

        this.resourceUri = resourceUri;
        this.tooltip = isEncrypted 
            ? `${resourceUri.fsPath} (encrypted)` 
            : resourceUri.fsPath;

        if (isDirectory) {
            this.contextValue = 'folder';
            this.iconPath = new vscode.ThemeIcon('folder');
        } else if (isEncrypted) {
            this.contextValue = 'encryptedFile';
            this.iconPath = new vscode.ThemeIcon('lock');
            this.command = {
                command: 'secureNotes.openEncrypted',
                title: 'Open Encrypted Note',
                arguments: [resourceUri]
            };
        } else {
            this.contextValue = 'file';
            this.iconPath = vscode.ThemeIcon.File;
            this.command = {
                command: 'vscode.open',
                title: 'Open Note',
                arguments: [resourceUri]
            };
        }
    }

    /**
     * Create a NoteItem from a file path
     */
    static fromPath(filePath: string, isDirectory: boolean): NoteItem {
        const uri = vscode.Uri.file(filePath);
        const isEncrypted = !isDirectory && filePath.endsWith('.enc');
        
        // For encrypted files, show the name without .enc extension
        let displayName = path.basename(filePath);
        if (isEncrypted) {
            displayName = displayName.replace(/\.enc$/, '');
        }
        
        const collapsibleState = isDirectory
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None;

        return new NoteItem(displayName, uri, isDirectory, isEncrypted, collapsibleState);
    }

    /**
     * Create a NoteItem for a new encrypted file
     */
    static forEncryptedFile(filePath: string, displayName: string): NoteItem {
        const uri = vscode.Uri.file(filePath);
        return new NoteItem(
            displayName,
            uri,
            false,
            true,
            vscode.TreeItemCollapsibleState.None
        );
    }
}
