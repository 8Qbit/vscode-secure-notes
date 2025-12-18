/**
 * Command handlers for SecureNotes extension
 * 
 * Implements file and folder operations: create, delete, rename, set base directory.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { NoteItem } from './noteItem';
import { CommandDependencies, FileOperationCallback } from './types';
import { commandLogger as logger } from './logger';
import { 
    BaseDirectoryNotSetError, 
    FileAlreadyExistsError,
    SecureNotesError 
} from './errors';

/**
 * Handles file and folder operations for SecureNotes
 */
export class NotepadCommands {
    private readonly getBaseDirectory: () => string | undefined;
    private readonly refresh: () => void;
    private readonly onFileMovedOrDeleted?: FileOperationCallback;

    constructor(deps: CommandDependencies) {
        this.getBaseDirectory = deps.getBaseDirectory;
        this.refresh = deps.refresh;
        this.onFileMovedOrDeleted = deps.onFileMovedOrDeleted;
    }

    /**
     * Create a new file in the notes directory
     */
    async createFile(item?: NoteItem): Promise<void> {
        const targetDir = this.getTargetDirectory(item);
        if (!targetDir) {
            new BaseDirectoryNotSetError().showError();
            return;
        }

        const fileName = await vscode.window.showInputBox({
            prompt: 'Enter the name for the new note',
            placeHolder: 'note.md',
            validateInput: (value) => {
                if (!value || value.trim() === '') {
                    return 'File name cannot be empty';
                }
                if (value.includes('/') || value.includes('\\')) {
                    return 'File name cannot contain path separators';
                }
                return null;
            }
        });

        if (!fileName) {
            return;
        }

        const filePath = path.join(targetDir, fileName);

        try {
            if (fs.existsSync(filePath)) {
                new FileAlreadyExistsError(filePath).showError();
                return;
            }

            fs.writeFileSync(filePath, '');
            this.refresh();

            logger.info('Created file', { filePath });

            // Open the new file
            const doc = await vscode.workspace.openTextDocument(filePath);
            await vscode.window.showTextDocument(doc);
        } catch (error) {
            logger.error('Failed to create file', error as Error, { filePath });
            vscode.window.showErrorMessage(`Failed to create file: ${(error as Error).message}`);
        }
    }

    /**
     * Create a new folder in the notes directory
     */
    async createFolder(item?: NoteItem): Promise<void> {
        const targetDir = this.getTargetDirectory(item);
        if (!targetDir) {
            new BaseDirectoryNotSetError().showError();
            return;
        }

        const folderName = await vscode.window.showInputBox({
            prompt: 'Enter the name for the new folder',
            placeHolder: 'new-folder',
            validateInput: (value) => {
                if (!value || value.trim() === '') {
                    return 'Folder name cannot be empty';
                }
                if (value.includes('/') || value.includes('\\')) {
                    return 'Folder name cannot contain path separators';
                }
                return null;
            }
        });

        if (!folderName) {
            return;
        }

        const folderPath = path.join(targetDir, folderName);

        try {
            if (fs.existsSync(folderPath)) {
                new FileAlreadyExistsError(folderPath).showError();
                return;
            }

            fs.mkdirSync(folderPath, { recursive: true });
            this.refresh();

            logger.info('Created folder', { folderPath });
        } catch (error) {
            logger.error('Failed to create folder', error as Error, { folderPath });
            vscode.window.showErrorMessage(`Failed to create folder: ${(error as Error).message}`);
        }
    }

    /**
     * Delete a file or folder
     */
    async delete(item: NoteItem): Promise<void> {
        if (!item) {
            vscode.window.showErrorMessage('No item selected');
            return;
        }

        const itemPath = item.actualPath;
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
            // Notify about deletion (for temp file cleanup)
            if (this.onFileMovedOrDeleted) {
                this.onFileMovedOrDeleted(itemPath);
            }

            if (item.isDirectory) {
                fs.rmSync(itemPath, { recursive: true, force: true });
            } else {
                fs.unlinkSync(itemPath);
            }

            this.refresh();

            logger.info('Deleted item', { itemPath, itemType });
            vscode.window.showInformationMessage(`Deleted ${itemType}: ${itemName}`);
        } catch (error) {
            logger.error('Failed to delete item', error as Error, { itemPath, itemType });
            vscode.window.showErrorMessage(`Failed to delete ${itemType}: ${(error as Error).message}`);
        }
    }

    /**
     * Rename a file or folder
     */
    async rename(item: NoteItem): Promise<void> {
        if (!item) {
            vscode.window.showErrorMessage('No item selected');
            return;
        }

        const oldPath = item.actualPath;
        const oldName = path.basename(oldPath);
        const parentDir = path.dirname(oldPath);

        // For display, show the name without .enc suffix for encrypted files
        const displayOldName = item.isEncrypted ? oldName.replace(/\.enc$/, '') : oldName;
        const extensionStart = displayOldName.lastIndexOf('.');

        const newDisplayName = await vscode.window.showInputBox({
            prompt: 'Enter the new name',
            value: displayOldName,
            valueSelection: [0, extensionStart > 0 ? extensionStart : displayOldName.length],
            validateInput: (value) => {
                if (!value || value.trim() === '') {
                    return 'Name cannot be empty';
                }
                if (value.includes('/') || value.includes('\\')) {
                    return 'Name cannot contain path separators';
                }
                return null;
            }
        });

        if (!newDisplayName || newDisplayName === displayOldName) {
            return;
        }

        // For encrypted files, add .enc suffix back to the new name
        const newName = item.isEncrypted ? newDisplayName + '.enc' : newDisplayName;
        const newPath = path.join(parentDir, newName);

        try {
            if (fs.existsSync(newPath)) {
                vscode.window.showErrorMessage(`"${newDisplayName}" already exists`);
                return;
            }

            // Notify about rename (for temp file cleanup)
            if (this.onFileMovedOrDeleted) {
                this.onFileMovedOrDeleted(oldPath);
            }

            fs.renameSync(oldPath, newPath);
            this.refresh();

            logger.info('Renamed item', { oldPath, newPath });
        } catch (error) {
            logger.error('Failed to rename item', error as Error, { oldPath, newPath });
            vscode.window.showErrorMessage(`Failed to rename: ${(error as Error).message}`);
        }
    }

    /**
     * Set the base directory for notes
     */
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
            
            logger.info('Set base directory', { selectedPath });
            vscode.window.showInformationMessage(`SecureNotes base directory set to: ${selectedPath}`);
        }
    }

    /**
     * Get the target directory for a file operation
     */
    private getTargetDirectory(item?: NoteItem): string | undefined {
        if (item) {
            return item.isDirectory ? item.actualPath : path.dirname(item.actualPath);
        }
        return this.getBaseDirectory();
    }
}
