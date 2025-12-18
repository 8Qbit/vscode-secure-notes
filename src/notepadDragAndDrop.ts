import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { NoteItem } from './noteItem';

export class NotepadDragAndDropController implements vscode.TreeDragAndDropController<NoteItem> {
    readonly dropMimeTypes = ['application/vnd.code.tree.secureNotesTree'];
    readonly dragMimeTypes = ['application/vnd.code.tree.secureNotesTree'];

    constructor(
        private getBaseDirectory: () => string | undefined,
        private refresh: () => void
    ) {}

    handleDrag(
        source: readonly NoteItem[],
        dataTransfer: vscode.DataTransfer,
        _token: vscode.CancellationToken
    ): void | Thenable<void> {
        // Store the dragged items' paths in the data transfer
        const paths = source.map(item => item.resourceUri.fsPath);
        dataTransfer.set(
            'application/vnd.code.tree.secureNotesTree',
            new vscode.DataTransferItem(paths)
        );
    }

    async handleDrop(
        target: NoteItem | undefined,
        dataTransfer: vscode.DataTransfer,
        _token: vscode.CancellationToken
    ): Promise<void> {
        const transferItem = dataTransfer.get('application/vnd.code.tree.secureNotesTree');
        if (!transferItem) {
            return;
        }

        const sourcePaths: string[] = transferItem.value;
        if (!sourcePaths || sourcePaths.length === 0) {
            return;
        }

        // Determine target directory
        let targetDir: string;
        if (target) {
            // If dropped on a folder, use that folder
            // If dropped on a file, use the file's parent directory
            targetDir = target.isDirectory 
                ? target.resourceUri.fsPath 
                : path.dirname(target.resourceUri.fsPath);
        } else {
            // If dropped on empty space, use base directory
            const baseDir = this.getBaseDirectory();
            if (!baseDir) {
                vscode.window.showErrorMessage('No base directory configured');
                return;
            }
            targetDir = baseDir;
        }

        // Move each source item to the target directory
        for (const sourcePath of sourcePaths) {
            const fileName = path.basename(sourcePath);
            const newPath = path.join(targetDir, fileName);

            // Don't move to same location
            if (sourcePath === newPath) {
                continue;
            }

            // Don't move a folder into itself
            if (targetDir.startsWith(sourcePath + path.sep)) {
                vscode.window.showErrorMessage(`Cannot move "${fileName}" into itself`);
                continue;
            }

            // Check if destination already exists
            if (fs.existsSync(newPath)) {
                const overwrite = await vscode.window.showWarningMessage(
                    `"${fileName}" already exists in destination. Overwrite?`,
                    { modal: true },
                    'Overwrite'
                );
                if (overwrite !== 'Overwrite') {
                    continue;
                }
                // Remove existing file/folder before moving
                fs.rmSync(newPath, { recursive: true, force: true });
            }

            try {
                fs.renameSync(sourcePath, newPath);
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to move "${fileName}": ${error}`);
            }
        }

        this.refresh();
    }
}


