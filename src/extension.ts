import * as vscode from 'vscode';
import { NotepadTreeProvider } from './notepadTreeProvider';
import { NotepadCommands } from './commands';
import { NotepadDragAndDropController } from './notepadDragAndDrop';

export function activate(context: vscode.ExtensionContext) {
    console.log('Cursor Notepad extension is now active');

    // Create the tree data provider
    const treeProvider = new NotepadTreeProvider();

    // Create drag and drop controller
    const dragAndDropController = new NotepadDragAndDropController(
        () => treeProvider.getBaseDirectory(),
        () => treeProvider.refresh()
    );

    // Register the tree view with drag and drop support
    const treeView = vscode.window.createTreeView('notepadTree', {
        treeDataProvider: treeProvider,
        showCollapseAll: true,
        canSelectMany: true,
        dragAndDropController: dragAndDropController
    });

    // Create command handlers
    const commands = new NotepadCommands(
        () => treeProvider.getBaseDirectory(),
        () => treeProvider.refresh()
    );

    // Register commands
    context.subscriptions.push(
        treeView,
        treeProvider,

        vscode.commands.registerCommand('notepad.createFile', (item) => 
            commands.createFile(item)
        ),
        
        vscode.commands.registerCommand('notepad.createFolder', (item) => 
            commands.createFolder(item)
        ),
        
        vscode.commands.registerCommand('notepad.delete', (item) => 
            commands.delete(item)
        ),
        
        vscode.commands.registerCommand('notepad.rename', (item) => 
            commands.rename(item)
        ),
        
        vscode.commands.registerCommand('notepad.refresh', () => 
            treeProvider.refresh()
        ),
        
        vscode.commands.registerCommand('notepad.setBaseDirectory', () => 
            commands.setBaseDirectory()
        )
    );

    // Show welcome message if no base directory is configured
    const baseDir = treeProvider.getBaseDirectory();
    if (!baseDir) {
        vscode.window.showInformationMessage(
            'Welcome to Cursor Notepad! Set your notes directory to get started.',
            'Set Directory'
        ).then(selection => {
            if (selection === 'Set Directory') {
                vscode.commands.executeCommand('notepad.setBaseDirectory');
            }
        });
    }
}

export function deactivate() {
    console.log('Cursor Notepad extension is now deactivated');
}

