import * as vscode from 'vscode';
import * as path from 'path';

export class NoteItem extends vscode.TreeItem {
    // Store the actual file path for operations (including .enc for encrypted files)
    public readonly actualPath: string;

    constructor(
        public readonly label: string,
        resourceUri: vscode.Uri,
        public readonly isDirectory: boolean,
        public readonly isEncrypted: boolean,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        actualPath?: string
    ) {
        super(label, collapsibleState);

        // Store the actual path for file operations
        this.actualPath = actualPath || resourceUri.fsPath;

        // For encrypted files, use a resourceUri without .enc so VS Code shows correct file type icon
        // For folders and regular files, use the actual resourceUri
        this.resourceUri = resourceUri;

        // Tooltip shows the actual path with encryption status
        this.tooltip = isEncrypted 
            ? `${this.actualPath} (encrypted)` 
            : this.actualPath;

        if (isDirectory) {
            this.contextValue = 'folder';
            // Don't set iconPath - VS Code will use theme folder icon based on resourceUri
        } else if (isEncrypted) {
            this.contextValue = 'encryptedFile';
            // Don't set iconPath - VS Code will use theme file icon based on resourceUri (without .enc)
            // Add a small description to indicate encryption
            this.description = '🔒';
            this.command = {
                command: 'secureNotes.openEncrypted',
                title: 'Open Encrypted Note',
                arguments: [vscode.Uri.file(this.actualPath)]
            };
        } else {
            this.contextValue = 'file';
            // Don't set iconPath - VS Code will use theme file icon based on resourceUri
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
        const fileName = path.basename(filePath);
        const isEncrypted = !isDirectory && fileName.endsWith('.enc');
        
        // For encrypted files, show the name without .enc suffix
        let displayName = fileName;
        let iconUri: vscode.Uri;

        if (isEncrypted) {
            displayName = fileName.replace(/\.enc$/, '');
            // Use a URI without .enc suffix for icon determination
            // This makes VS Code show the correct file type icon (e.g., .md icon for note.md.enc)
            iconUri = vscode.Uri.file(path.join(path.dirname(filePath), displayName));
        } else {
            iconUri = vscode.Uri.file(filePath);
        }
        
        const collapsibleState = isDirectory
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None;

        return new NoteItem(displayName, iconUri, isDirectory, isEncrypted, collapsibleState, filePath);
    }

    /**
     * Create a NoteItem for a new encrypted file
     */
    static forEncryptedFile(filePath: string, displayName: string): NoteItem {
        // Use a URI without .enc suffix for icon determination
        const dir = path.dirname(filePath);
        const iconUri = vscode.Uri.file(path.join(dir, displayName));
        return new NoteItem(
            displayName,
            iconUri,
            false,
            true,
            vscode.TreeItemCollapsibleState.None,
            filePath
        );
    }
}
