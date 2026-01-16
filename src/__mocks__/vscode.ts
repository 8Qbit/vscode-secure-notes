/**
 * Mock VS Code module for testing
 * 
 * Provides minimal mocks for VS Code APIs used in the extension.
 */

export const Uri = {
    file: (path: string) => ({ fsPath: path, path, scheme: 'file' }),
    parse: (str: string) => ({ fsPath: str, path: str, scheme: 'file' }),
};

// Config values that tests can override
// Keys should be the full path from config.get(), e.g. 'encryption.publicKeyPath'
export const mockConfigValues: Record<string, unknown> = {};

// Helper to create config getter
const createConfigGetter = () => (key: string, defaultValue?: unknown) => {
    // Map key path to our mock values
    // For 'encryption.publicKeyPath', map to mockConfigValues['publicKeyPath']
    const shortKey = key.replace('encryption.', '');
    return mockConfigValues[shortKey] ?? mockConfigValues[key] ?? defaultValue;
};

// EventEmitter class - must be declared before it's used
export class EventEmitter<T> {
    private listeners: ((e: T) => void)[] = [];
    
    event = (listener: (e: T) => void) => {
        this.listeners.push(listener);
        return { dispose: () => {} };
    };
    
    fire(e: T) {
        this.listeners.forEach(l => l(e));
    }
    
    dispose() {
        this.listeners = [];
    }
}

// Event emitters for testing - allow tests to fire events
export const workspaceEventEmitters = {
    onDidChangeConfiguration: new EventEmitter<{ affectsConfiguration: (section: string) => boolean }>(),
    onDidSaveTextDocument: new EventEmitter<{ uri: { fsPath: string }; isDirty: boolean }>(),
    onDidCloseTextDocument: new EventEmitter<{ uri: { fsPath: string } }>(),
    onDidChangeTextDocument: new EventEmitter<{ document: { uri: { fsPath: string }; isDirty: boolean; isUntitled: boolean; isClosed: boolean; save: () => Promise<boolean> } }>(),
};

export const workspace = {
    getConfiguration: jest.fn((_section?: string) => ({
        get: createConfigGetter(),
        update: jest.fn(),
    })),
    openTextDocument: jest.fn(),
    textDocuments: [] as Array<{ uri: { fsPath: string }; isDirty: boolean; isUntitled: boolean; isClosed: boolean; save: () => Promise<boolean> }>,
    createFileSystemWatcher: jest.fn(() => ({
        onDidCreate: jest.fn(),
        onDidChange: jest.fn(),
        onDidDelete: jest.fn(),
        dispose: jest.fn(),
    })),
    onDidChangeConfiguration: jest.fn((listener: (e: { affectsConfiguration: (section: string) => boolean }) => void) => {
        return workspaceEventEmitters.onDidChangeConfiguration.event(listener);
    }),
    onDidSaveTextDocument: jest.fn((listener: (doc: unknown) => void) => {
        return workspaceEventEmitters.onDidSaveTextDocument.event(listener);
    }),
    onDidCloseTextDocument: jest.fn((listener: (doc: unknown) => void) => {
        return workspaceEventEmitters.onDidCloseTextDocument.event(listener);
    }),
    onDidChangeTextDocument: jest.fn((listener: (e: unknown) => void) => {
        return workspaceEventEmitters.onDidChangeTextDocument.event(listener);
    }),
};

export const window = {
    showInformationMessage: jest.fn(),
    showWarningMessage: jest.fn(),
    showErrorMessage: jest.fn(),
    showInputBox: jest.fn(),
    showOpenDialog: jest.fn(),
    showTextDocument: jest.fn(),
    createOutputChannel: jest.fn(() => ({
        appendLine: jest.fn(),
        append: jest.fn(),
        show: jest.fn(),
        dispose: jest.fn(),
    })),
    tabGroups: {
        all: [],
        onDidChangeTabs: jest.fn(() => ({ dispose: jest.fn() })),
        close: jest.fn(),
    },
};

export const commands = {
    registerCommand: jest.fn(),
    executeCommand: jest.fn(),
};

export enum TreeItemCollapsibleState {
    None = 0,
    Collapsed = 1,
    Expanded = 2,
}

export class TreeItem {
    label: string;
    collapsibleState: TreeItemCollapsibleState;
    contextValue?: string;
    command?: unknown;
    resourceUri?: unknown;
    tooltip?: string;
    description?: string;

    constructor(label: string, collapsibleState: TreeItemCollapsibleState = TreeItemCollapsibleState.None) {
        this.label = label;
        this.collapsibleState = collapsibleState;
    }
}

export class FileSystemWatcher {
    onDidChange = jest.fn(() => ({ dispose: jest.fn() }));
    onDidCreate = jest.fn(() => ({ dispose: jest.fn() }));
    onDidDelete = jest.fn(() => ({ dispose: jest.fn() }));
    dispose = jest.fn();
}

export class RelativePattern {
    constructor(public base: string, public pattern: string) {}
}

export const ConfigurationTarget = {
    Global: 1,
    Workspace: 2,
    WorkspaceFolder: 3,
};

export const ExtensionMode = {
    Production: 1,
    Development: 2,
    Test: 3,
};

export class Disposable {
    static from(...disposables: { dispose: () => void }[]): Disposable {
        return new Disposable(() => disposables.forEach(d => d.dispose()));
    }
    
    constructor(private callOnDispose: () => void) {}
    
    dispose() {
        this.callOnDispose();
    }
}

export class DataTransferItem {
    constructor(public value: unknown) {}
}

export class DataTransfer {
    private items = new Map<string, DataTransferItem>();
    
    get(mimeType: string) {
        return this.items.get(mimeType);
    }
    
    set(mimeType: string, value: DataTransferItem) {
        this.items.set(mimeType, value);
    }
}

export class TabInputText {
    constructor(public uri: { fsPath: string }) {}
}

export enum ProgressLocation {
    Notification = 15,
    Window = 10,
    SourceControl = 1,
}
