/**
 * Tree data provider for SecureNotes extension
 * 
 * Provides data for the file tree view, handles directory reading,
 * and manages file system watching with debouncing.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { NoteItem } from './noteItem';
import { getBaseDirectory as getBaseDir } from './types';
import { treeLogger as logger } from './logger';
import { debounce } from './fileUtils';

/** Debounce delay for tree refresh (ms) */
const REFRESH_DEBOUNCE_MS = 150;

/**
 * Provides data for the SecureNotes tree view
 */
export class NotepadTreeProvider implements vscode.TreeDataProvider<NoteItem>, vscode.Disposable {
    private readonly _onDidChangeTreeData = new vscode.EventEmitter<NoteItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private fileWatcher: vscode.FileSystemWatcher | undefined;
    private configWatcher: vscode.Disposable | undefined;
    private readonly debouncedRefresh: (() => void) & { cancel: () => void };

    constructor() {
        // Create debounced refresh function
        this.debouncedRefresh = debounce(() => {
            this._onDidChangeTreeData.fire();
        }, REFRESH_DEBOUNCE_MS);

        this.setupFileWatcher();
        this.setupConfigWatcher();

        logger.info('TreeProvider initialized');
    }

    /**
     * Trigger a tree refresh
     */
    refresh(): void {
        this.debouncedRefresh();
    }

    /**
     * Force an immediate refresh (bypasses debounce)
     */
    forceRefresh(): void {
        this.debouncedRefresh.cancel();
        this._onDidChangeTreeData.fire();
    }

    /**
     * Get tree item for display
     */
    getTreeItem(element: NoteItem): vscode.TreeItem {
        return element;
    }

    /**
     * Get children of a tree item
     */
    getChildren(element?: NoteItem): Thenable<NoteItem[]> {
        const baseDir = this.getBaseDirectory();

        if (!baseDir) {
            return Promise.resolve([]);
        }

        if (!fs.existsSync(baseDir)) {
            logger.warn('Base directory does not exist', { baseDir });
            vscode.window.showWarningMessage(`Notes directory does not exist: ${baseDir}`);
            return Promise.resolve([]);
        }

        // If no element, return the root node (base directory itself)
        if (!element) {
            const rootNode = NoteItem.forRootDirectory(baseDir);
            return Promise.resolve([rootNode]);
        }

        // Otherwise, return the contents of the directory
        return Promise.resolve(this.getFilesInDirectory(element.actualPath));
    }

    /**
     * Get the configured base directory
     */
    getBaseDirectory(): string | undefined {
        return getBaseDir();
    }

    /**
     * Get files and folders in a directory
     */
    private getFilesInDirectory(dirPath: string): NoteItem[] {
        try {
            const entries = fs.readdirSync(dirPath, { withFileTypes: true });

            const items: NoteItem[] = entries
                .filter(entry => this.shouldShowEntry(entry))
                .map(entry => {
                    const fullPath = path.join(dirPath, entry.name);
                    return NoteItem.fromPath(fullPath, entry.isDirectory());
                })
                .sort((a, b) => this.sortItems(a, b));

            logger.debug('Read directory', { 
                dirPath, 
                itemCount: items.length 
            });

            return items;
        } catch (error) {
            logger.error('Error reading directory', error as Error, { dirPath });
            return [];
        }
    }

    /**
     * Determine if an entry should be shown in the tree
     */
    private shouldShowEntry(entry: fs.Dirent): boolean {
        // Hide hidden files
        if (entry.name.startsWith('.')) {
            return false;
        }
        return true;
    }

    /**
     * Sort tree items: folders first, then alphabetically
     */
    private sortItems(a: NoteItem, b: NoteItem): number {
        if (a.isDirectory && !b.isDirectory) {
            return -1;
        }
        if (!a.isDirectory && b.isDirectory) {
            return 1;
        }
        return (a.label as string).localeCompare(b.label as string);
    }

    /**
     * Set up file system watcher for the base directory
     */
    private setupFileWatcher(): void {
        this.disposeFileWatcher();

        const baseDir = this.getBaseDirectory();
        if (!baseDir) {
            return;
        }

        logger.debug('Setting up file watcher', { baseDir });

        const pattern = new vscode.RelativePattern(baseDir, '**/*');
        this.fileWatcher = vscode.workspace.createFileSystemWatcher(pattern);

        // Use debounced refresh for all file events
        this.fileWatcher.onDidCreate(() => this.refresh());
        this.fileWatcher.onDidDelete(() => this.refresh());
        this.fileWatcher.onDidChange(() => this.refresh());
    }

    /**
     * Set up configuration change watcher
     */
    private setupConfigWatcher(): void {
        this.configWatcher = vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('secureNotes.baseDirectory') ||
                e.affectsConfiguration('secureNotes.encryption')) {
                logger.info('Configuration changed, refreshing');
                this.setupFileWatcher();
                this.forceRefresh();
            }
        });
    }

    /**
     * Dispose the file watcher
     */
    private disposeFileWatcher(): void {
        if (this.fileWatcher) {
            this.fileWatcher.dispose();
            this.fileWatcher = undefined;
        }
    }

    /**
     * Dispose all resources
     */
    dispose(): void {
        this.debouncedRefresh.cancel();
        this.disposeFileWatcher();
        
        if (this.configWatcher) {
            this.configWatcher.dispose();
        }
        
        this._onDidChangeTreeData.dispose();
        
        logger.info('TreeProvider disposed');
    }
}
