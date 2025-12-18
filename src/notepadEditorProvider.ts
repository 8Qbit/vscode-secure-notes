import * as vscode from 'vscode';
import { DocumentStore } from './documentStore';
import { NotepadEncryption } from './encryption';

/**
 * Custom document for encrypted notes.
 * Tracks the document URI and content changes.
 */
class SecureNoteDocument implements vscode.CustomDocument {
    private _content: string = '';
    private _savedContent: string = '';

    constructor(readonly uri: vscode.Uri) {}

    get content(): string {
        return this._content;
    }

    set content(value: string) {
        this._content = value;
    }

    get isDirty(): boolean {
        return this._content !== this._savedContent;
    }

    markSaved(): void {
        this._savedContent = this._content;
    }

    dispose(): void {
        // Clean up if needed
    }
}

/**
 * Custom editor provider for encrypted notepad files.
 * Uses CustomEditorProvider for full control over document lifecycle.
 */
export class NotepadEditorProvider implements vscode.CustomEditorProvider<SecureNoteDocument> {
    public static readonly viewType = 'secureNotes.encryptedEditor';

    private readonly _onDidChangeCustomDocument = new vscode.EventEmitter<
        vscode.CustomDocumentContentChangeEvent<SecureNoteDocument>
    >();
    readonly onDidChangeCustomDocument = this._onDidChangeCustomDocument.event;

    private documents = new Map<string, SecureNoteDocument>();
    private webviews = new Map<string, vscode.WebviewPanel>();

    constructor(
        private readonly documentStore: DocumentStore,
        private readonly encryption: NotepadEncryption
    ) {}

    /**
     * Called when VS Code needs to open a document
     */
    async openCustomDocument(
        uri: vscode.Uri,
        _openContext: vscode.CustomDocumentOpenContext,
        _token: vscode.CancellationToken
    ): Promise<SecureNoteDocument> {
        const document = new SecureNoteDocument(uri);
        
        // Ensure encryption is unlocked
        if (!this.encryption.getIsUnlocked()) {
            const unlocked = await this.encryption.unlock();
            if (!unlocked) {
                throw new Error('Encryption not unlocked');
            }
        }

        // Load and decrypt the content
        try {
            const content = await this.documentStore.open(uri.fsPath);
            document.content = content.toString('utf8');
            document.markSaved();
        } catch (error) {
            throw new Error(`Failed to decrypt: ${(error as Error).message}`);
        }

        this.documents.set(uri.fsPath, document);
        return document;
    }

    /**
     * Called to render the editor UI
     */
    async resolveCustomEditor(
        document: SecureNoteDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        this.webviews.set(document.uri.fsPath, webviewPanel);

        webviewPanel.webview.options = {
            enableScripts: true
        };

        // Set up the webview with the content
        webviewPanel.webview.html = this.getEditorHtml(document.content);

        // Handle messages from the webview
        webviewPanel.webview.onDidReceiveMessage(async (message) => {
            switch (message.type) {
                case 'contentChanged':
                    document.content = message.content;
                    this.documentStore.update(document.uri.fsPath, Buffer.from(message.content, 'utf8'));
                    // Notify VS Code that the document changed
                    this._onDidChangeCustomDocument.fire({ document });
                    break;
                case 'ready':
                    // Webview is ready, send current content
                    webviewPanel.webview.postMessage({
                        type: 'setContent',
                        content: document.content
                    });
                    break;
            }
        });

        // Handle panel disposal
        webviewPanel.onDidDispose(() => {
            this.webviews.delete(document.uri.fsPath);
        });
    }

    /**
     * Called when saving the document
     */
    async saveCustomDocument(
        document: SecureNoteDocument,
        _cancellation: vscode.CancellationToken
    ): Promise<void> {
        try {
            this.documentStore.update(document.uri.fsPath, Buffer.from(document.content, 'utf8'));
            await this.documentStore.save(document.uri.fsPath);
            document.markSaved();
            
            // Update webview status
            const webview = this.webviews.get(document.uri.fsPath);
            if (webview) {
                webview.webview.postMessage({ type: 'saved' });
            }
        } catch (error) {
            throw new Error(`Failed to save: ${(error as Error).message}`);
        }
    }

    /**
     * Called when saving to a different location
     */
    async saveCustomDocumentAs(
        document: SecureNoteDocument,
        destination: vscode.Uri,
        _cancellation: vscode.CancellationToken
    ): Promise<void> {
        try {
            await this.documentStore.create(destination.fsPath, Buffer.from(document.content, 'utf8'));
        } catch (error) {
            throw new Error(`Failed to save as: ${(error as Error).message}`);
        }
    }

    /**
     * Called when reverting changes
     */
    async revertCustomDocument(
        document: SecureNoteDocument,
        _cancellation: vscode.CancellationToken
    ): Promise<void> {
        try {
            const content = await this.documentStore.open(document.uri.fsPath);
            document.content = content.toString('utf8');
            document.markSaved();

            // Update webview
            const webview = this.webviews.get(document.uri.fsPath);
            if (webview) {
                webview.webview.postMessage({
                    type: 'setContent',
                    content: document.content
                });
            }
        } catch (error) {
            throw new Error(`Failed to revert: ${(error as Error).message}`);
        }
    }

    /**
     * Called for backup (hot exit)
     */
    async backupCustomDocument(
        document: SecureNoteDocument,
        context: vscode.CustomDocumentBackupContext,
        _cancellation: vscode.CancellationToken
    ): Promise<vscode.CustomDocumentBackup> {
        // For security, we don't backup decrypted content
        // Just return a dummy backup
        return {
            id: context.destination.toString(),
            delete: () => { /* nothing to delete */ }
        };
    }

    private getEditorHtml(content: string): string {
        const escapedContent = content
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Encrypted Note</title>
    <style>
        body {
            margin: 0;
            padding: 0;
            height: 100vh;
            display: flex;
            flex-direction: column;
            font-family: var(--vscode-font-family);
            background: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
        }
        .toolbar {
            display: flex;
            align-items: center;
            padding: 8px;
            gap: 8px;
            background: var(--vscode-editor-inactiveSelectionBackground);
            border-bottom: 1px solid var(--vscode-widget-border);
        }
        .status {
            margin-left: auto;
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
        }
        .status.modified {
            color: var(--vscode-editorWarning-foreground);
        }
        #editor {
            flex: 1;
            padding: 16px;
            border: none;
            outline: none;
            resize: none;
            font-family: var(--vscode-editor-font-family);
            font-size: var(--vscode-editor-font-size);
            line-height: var(--vscode-editor-line-height);
            background: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
        }
        .lock-icon {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            font-size: 12px;
            color: var(--vscode-charts-green);
        }
    </style>
</head>
<body>
    <div class="toolbar">
        <span class="lock-icon">🔒 Encrypted</span>
        <span id="status" class="status">Saved</span>
    </div>
    <textarea id="editor">${escapedContent}</textarea>

    <script>
        const vscode = acquireVsCodeApi();
        const editor = document.getElementById('editor');
        const status = document.getElementById('status');
        
        let isDirty = false;
        let originalContent = editor.value;

        // Listen for messages from the extension
        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.type) {
                case 'setContent':
                    editor.value = message.content;
                    originalContent = message.content;
                    isDirty = false;
                    status.textContent = 'Saved';
                    status.className = 'status';
                    break;
                case 'saved':
                    originalContent = editor.value;
                    isDirty = false;
                    status.textContent = 'Saved';
                    status.className = 'status';
                    break;
            }
        });

        editor.addEventListener('input', () => {
            isDirty = editor.value !== originalContent;
            status.textContent = isDirty ? 'Modified' : 'Saved';
            status.className = 'status' + (isDirty ? ' modified' : '');
            
            // Notify extension of content change
            vscode.postMessage({
                type: 'contentChanged',
                content: editor.value
            });
        });

        // Focus editor on load
        editor.focus();

        // Notify extension that webview is ready
        vscode.postMessage({ type: 'ready' });
    </script>
</body>
</html>`;
    }
}
