import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { NoteItem } from './noteItem';
import { NotepadEncryption } from './encryption';

export class NotepadTreeProvider implements vscode.TreeDataProvider<NoteItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<NoteItem | undefined | null | void> = 
        new vscode.EventEmitter<NoteItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<NoteItem | undefined | null | void> = 
        this._onDidChangeTreeData.event;

    private fileWatcher: vscode.FileSystemWatcher | undefined;
    private configWatcher: vscode.Disposable | undefined;

    constructor() {
        this.setupFileWatcher();
        this.setupConfigWatcher();
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: NoteItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: NoteItem): Thenable<NoteItem[]> {
        const baseDir = this.getBaseDirectory();

        if (!baseDir) {
            return Promise.resolve([]);
        }

        if (!fs.existsSync(baseDir)) {
            vscode.window.showWarningMessage(`Notepad directory does not exist: ${baseDir}`);
            return Promise.resolve([]);
        }

        const targetDir = element ? element.actualPath : baseDir;
        return Promise.resolve(this.getFilesInDirectory(targetDir));
    }

    getBaseDirectory(): string | undefined {
        const config = vscode.workspace.getConfiguration('secureNotes');
        const baseDir = config.get<string>('baseDirectory');
        return baseDir && baseDir.trim() !== '' ? baseDir : undefined;
    }

    private getFilesInDirectory(dirPath: string): NoteItem[] {
        const encryptionEnabled = NotepadEncryption.isEnabled();

        try {
            const entries = fs.readdirSync(dirPath, { withFileTypes: true });
            
            const items: NoteItem[] = entries
                .filter(entry => {
                    // Hide hidden files
                    if (entry.name.startsWith('.')) {
                        return false;
                    }
                    
                    // If encryption is enabled, only show directories and .enc files
                    if (encryptionEnabled && !entry.isDirectory()) {
                        return entry.name.endsWith('.enc');
                    }
                    
                    return true;
                })
                .map(entry => {
                    const fullPath = path.join(dirPath, entry.name);
                    return NoteItem.fromPath(fullPath, entry.isDirectory());
                })
                .sort((a, b) => {
                    // Folders first, then files, both alphabetically
                    if (a.isDirectory && !b.isDirectory) {
                        return -1;
                    }
                    if (!a.isDirectory && b.isDirectory) {
                        return 1;
                    }
                    return a.label.localeCompare(b.label);
                });

            return items;
        } catch (error) {
            console.error(`Error reading directory ${dirPath}:`, error);
            return [];
        }
    }

    private setupFileWatcher(): void {
        this.disposeFileWatcher();

        const baseDir = this.getBaseDirectory();
        if (!baseDir) {
            return;
        }

        // Watch for all file changes in the base directory
        const pattern = new vscode.RelativePattern(baseDir, '**/*');
        this.fileWatcher = vscode.workspace.createFileSystemWatcher(pattern);

        this.fileWatcher.onDidCreate(() => this.refresh());
        this.fileWatcher.onDidDelete(() => this.refresh());
        this.fileWatcher.onDidChange(() => this.refresh());
    }

    private setupConfigWatcher(): void {
        this.configWatcher = vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('secureNotes.baseDirectory') ||
                e.affectsConfiguration('secureNotes.encryption')) {
                this.setupFileWatcher();
                this.refresh();
            }
        });
    }

    private disposeFileWatcher(): void {
        if (this.fileWatcher) {
            this.fileWatcher.dispose();
            this.fileWatcher = undefined;
        }
    }

    dispose(): void {
        this.disposeFileWatcher();
        if (this.configWatcher) {
            this.configWatcher.dispose();
        }
        this._onDidChangeTreeData.dispose();
    }
}
