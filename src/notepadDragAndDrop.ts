/**
 * Drag and drop controller for SecureNotes extension
 * 
 * Handles moving files and folders via drag and drop in the tree view.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { NoteItem } from './noteItem';
import { FileOperationCallback } from './types';
import { commandLogger as logger } from './logger';
import { validatePathWithinBase, validateNewPathWithinBase, PathSecurityError } from './fileUtils';

/** MIME type for tree item drag data */
const TREE_MIME_TYPE = 'application/vnd.code.tree.secureNotesTree';

/**
 * Handles drag and drop operations in the SecureNotes tree view
 */
export class NotepadDragAndDropController implements vscode.TreeDragAndDropController<NoteItem> {
    readonly dropMimeTypes = [TREE_MIME_TYPE];
    readonly dragMimeTypes = [TREE_MIME_TYPE];

    constructor(
        private readonly getBaseDirectory: () => string | undefined,
        private readonly refresh: () => void,
        private readonly onFileMoved?: FileOperationCallback
    ) {}

    /**
     * Handle drag start - store dragged item paths
     */
    handleDrag(
        source: readonly NoteItem[],
        dataTransfer: vscode.DataTransfer,
        _token: vscode.CancellationToken
    ): void {
        const paths = source.map(item => item.actualPath);
        dataTransfer.set(TREE_MIME_TYPE, new vscode.DataTransferItem(paths));
        
        logger.debug('Drag started', { itemCount: paths.length });
    }

    /**
     * Handle drop - move items to target location
     */
    async handleDrop(
        target: NoteItem | undefined,
        dataTransfer: vscode.DataTransfer,
        _token: vscode.CancellationToken
    ): Promise<void> {
        const transferItem = dataTransfer.get(TREE_MIME_TYPE);
        if (!transferItem) {
            return;
        }

        const sourcePaths: string[] = transferItem.value;
        if (!sourcePaths || sourcePaths.length === 0) {
            return;
        }

        // Determine target directory
        const targetDir = this.resolveTargetDirectory(target);
        if (!targetDir) {
            vscode.window.showErrorMessage('No base directory configured');
            return;
        }

        logger.debug('Drop initiated', { 
            sourcePaths, 
            targetDir,
            itemCount: sourcePaths.length 
        });

        // Move each source item
        for (const sourcePath of sourcePaths) {
            await this.moveItem(sourcePath, targetDir);
        }

        this.refresh();
    }

    /**
     * Resolve the target directory for a drop operation
     */
    private resolveTargetDirectory(target: NoteItem | undefined): string | undefined {
        if (target) {
            // If dropped on a folder, use that folder
            // If dropped on a file, use the file's parent directory
            return target.isDirectory 
                ? target.actualPath 
                : path.dirname(target.actualPath);
        }
        
        // If dropped on empty space, use base directory
        return this.getBaseDirectory();
    }

    /**
     * Move a single item to the target directory
     */
    private async moveItem(sourcePath: string, targetDir: string): Promise<void> {
        const baseDir = this.getBaseDirectory();
        if (!baseDir) {
            vscode.window.showErrorMessage('No base directory configured');
            return;
        }

        // SECURITY: Validate source path is within notes directory
        try {
            validatePathWithinBase(sourcePath, baseDir);
        } catch (error) {
            if (error instanceof PathSecurityError) {
                logger.error('Security violation in drag/drop (source)', error, { 
                    sourcePath, 
                    baseDir 
                });
                vscode.window.showErrorMessage('Cannot move: source is outside notes directory');
                return;
            }
            throw error;
        }

        // SECURITY: Validate target directory is within notes directory
        try {
            validatePathWithinBase(targetDir, baseDir);
        } catch (error) {
            if (error instanceof PathSecurityError) {
                logger.error('Security violation in drag/drop (target)', error, { 
                    targetDir, 
                    baseDir 
                });
                vscode.window.showErrorMessage('Cannot move: target is outside notes directory');
                return;
            }
            throw error;
        }

        const fileName = path.basename(sourcePath);
        const newPath = path.join(targetDir, fileName);

        // SECURITY: Validate final path is within notes directory
        try {
            validateNewPathWithinBase(newPath, baseDir);
        } catch (error) {
            if (error instanceof PathSecurityError) {
                logger.error('Security violation in drag/drop (new path)', error, { 
                    newPath, 
                    baseDir 
                });
                vscode.window.showErrorMessage('Cannot move: destination is outside notes directory');
                return;
            }
            throw error;
        }

        // Don't move to same location
        if (sourcePath === newPath) {
            return;
        }

        // Don't move a folder into itself
        if (targetDir.startsWith(sourcePath + path.sep)) {
            vscode.window.showErrorMessage(`Cannot move "${fileName}" into itself`);
            return;
        }

        // Check if destination already exists
        if (fs.existsSync(newPath)) {
            const overwrite = await vscode.window.showWarningMessage(
                `"${fileName}" already exists in destination. Overwrite?`,
                { modal: true },
                'Overwrite'
            );
            
            if (overwrite !== 'Overwrite') {
                return;
            }
            
            // Remove existing file/folder before moving
            fs.rmSync(newPath, { recursive: true, force: true });
        }

        try {
            // Notify that file is being moved (for temp file cleanup)
            if (this.onFileMoved) {
                this.onFileMoved(sourcePath);
            }

            fs.renameSync(sourcePath, newPath);
            
            logger.info('Moved item', { sourcePath, newPath });
        } catch (error) {
            logger.error('Failed to move item', error as Error, { sourcePath, newPath });
            vscode.window.showErrorMessage(`Failed to move "${fileName}": ${(error as Error).message}`);
        }
    }
}
