import * as vscode from 'vscode';
import * as path from 'path';

export class NoteItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly resourceUri: vscode.Uri,
        public readonly isDirectory: boolean,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(label, collapsibleState);

        this.resourceUri = resourceUri;
        this.tooltip = resourceUri.fsPath;

        if (isDirectory) {
            this.contextValue = 'folder';
            this.iconPath = new vscode.ThemeIcon('folder');
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

    static fromPath(filePath: string, isDirectory: boolean): NoteItem {
        const uri = vscode.Uri.file(filePath);
        const name = path.basename(filePath);
        const collapsibleState = isDirectory
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None;

        return new NoteItem(name, uri, isDirectory, collapsibleState);
    }
}

