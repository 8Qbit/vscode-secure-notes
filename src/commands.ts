import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { NoteItem } from './noteItem';

export class NotepadCommands {
    constructor(
        private getBaseDirectory: () => string | undefined,
        private refresh: () => void
    ) {}

    async createFile(item?: NoteItem): Promise<void> {
        const targetDir = this.getTargetDirectory(item);
        if (!targetDir) {
            vscode.window.showErrorMessage('Please set a base directory first using "SecureNotes: Set Base Directory"');
            return;
        }

        const fileName = await vscode.window.showInputBox({
            prompt: 'Enter the name for the new note',
            placeHolder: 'note.md'
        });

        if (!fileName) {
            return;
        }

        const filePath = path.join(targetDir, fileName);

        try {
            if (fs.existsSync(filePath)) {
                vscode.window.showErrorMessage(`File "${fileName}" already exists`);
                return;
            }

            fs.writeFileSync(filePath, '');
            this.refresh();

            // Open the new file
            const doc = await vscode.workspace.openTextDocument(filePath);
            await vscode.window.showTextDocument(doc);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to create file: ${error}`);
        }
    }

    async createFolder(item?: NoteItem): Promise<void> {
        const targetDir = this.getTargetDirectory(item);
        if (!targetDir) {
            vscode.window.showErrorMessage('Please set a base directory first using "SecureNotes: Set Base Directory"');
            return;
        }

        const folderName = await vscode.window.showInputBox({
            prompt: 'Enter the name for the new folder',
            placeHolder: 'new-folder'
        });

        if (!folderName) {
            return;
        }

        const folderPath = path.join(targetDir, folderName);

        try {
            if (fs.existsSync(folderPath)) {
                vscode.window.showErrorMessage(`Folder "${folderName}" already exists`);
                return;
            }

            fs.mkdirSync(folderPath, { recursive: true });
            this.refresh();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to create folder: ${error}`);
        }
    }

    async delete(item: NoteItem): Promise<void> {
        if (!item || !item.resourceUri) {
            vscode.window.showErrorMessage('No item selected');
            return;
        }

        const itemPath = item.resourceUri.fsPath;
        const itemName = path.basename(itemPath);
        const itemType = item.isDirectory ? 'folder' : 'file';

        const confirmation = await vscode.window.showWarningMessage(
            `Are you sure you want to delete "${itemName}"?`,
            { modal: true },
            'Delete'
        );

        if (confirmation !== 'Delete') {
            return;
        }

        try {
            if (item.isDirectory) {
                fs.rmSync(itemPath, { recursive: true, force: true });
            } else {
                fs.unlinkSync(itemPath);
            }
            this.refresh();
            vscode.window.showInformationMessage(`Deleted ${itemType}: ${itemName}`);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to delete ${itemType}: ${error}`);
        }
    }

    async rename(item: NoteItem): Promise<void> {
        if (!item || !item.resourceUri) {
            vscode.window.showErrorMessage('No item selected');
            return;
        }

        const oldPath = item.resourceUri.fsPath;
        const oldName = path.basename(oldPath);
        const parentDir = path.dirname(oldPath);

        const newName = await vscode.window.showInputBox({
            prompt: 'Enter the new name',
            value: oldName,
            valueSelection: [0, oldName.lastIndexOf('.') > 0 ? oldName.lastIndexOf('.') : oldName.length]
        });

        if (!newName || newName === oldName) {
            return;
        }

        const newPath = path.join(parentDir, newName);

        try {
            if (fs.existsSync(newPath)) {
                vscode.window.showErrorMessage(`"${newName}" already exists`);
                return;
            }

            fs.renameSync(oldPath, newPath);
            this.refresh();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to rename: ${error}`);
        }
    }

    async setBaseDirectory(): Promise<void> {
        const result = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: 'Select Notes Folder'
        });

        if (result && result[0]) {
            const selectedPath = result[0].fsPath;
            await vscode.workspace.getConfiguration('secureNotes').update(
                'baseDirectory',
                selectedPath,
                vscode.ConfigurationTarget.Global
            );
            this.refresh();
            vscode.window.showInformationMessage(`SecureNotes base directory set to: ${selectedPath}`);
        }
    }

    private getTargetDirectory(item?: NoteItem): string | undefined {
        if (item && item.resourceUri) {
            return item.isDirectory ? item.resourceUri.fsPath : path.dirname(item.resourceUri.fsPath);
        }
        return this.getBaseDirectory();
    }
}


