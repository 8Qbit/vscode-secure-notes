/**
 * SecureNotes Extension - Main Entry Point
 * 
 * A secure notes extension for VS Code/Cursor with encryption support.
 * Files are encrypted at rest and decrypted in RAM for editing.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { NotepadTreeProvider } from './notepadTreeProvider';
import { NotepadCommands } from './commands';
import { NotepadDragAndDropController } from './notepadDragAndDrop';
import { NotepadEncryption } from './encryption';
import { TempFileManager } from './tempFileManager';
import { NoteItem } from './noteItem';
import { logger, LogLevel } from './logger';
import { getAllFiles } from './fileUtils';

// Global state
let encryption: NotepadEncryption;
let tempFileManager: TempFileManager | undefined;
let outputChannel: vscode.OutputChannel;

/**
 * Extension activation
 */
export function activate(context: vscode.ExtensionContext) {
    // Create output channel for logging
    outputChannel = vscode.window.createOutputChannel('SecureNotes');
    logger.initialize(outputChannel);
    
    // Set log level based on development mode
    if (context.extensionMode === vscode.ExtensionMode.Development) {
        logger.setLevel(LogLevel.DEBUG);
    }

    logger.info('SecureNotes extension activating', 'Extension');

    // Initialize encryption
    encryption = new NotepadEncryption();
    context.subscriptions.push(encryption);

    // Initialize temp file manager if available
    if (TempFileManager.isAvailable()) {
        tempFileManager = new TempFileManager(encryption);
        logger.info('Using /dev/shm for secure temp files', 'Extension');
    } else {
        logger.warn('/dev/shm not available, encrypted editing disabled', 'Extension');
        vscode.window.showWarningMessage(
            'SecureNotes: /dev/shm is not available. Encrypted file editing requires Linux with /dev/shm.'
        );
    }

    // Create tree data provider
    const treeProvider = new NotepadTreeProvider();
    context.subscriptions.push(treeProvider);

    // Create drag and drop controller
    const dragAndDropController = new NotepadDragAndDropController(
        () => treeProvider.getBaseDirectory(),
        () => treeProvider.refresh(),
        (oldPath: string) => tempFileManager?.onFileMovedOrDeleted(oldPath)
    );

    // Register tree view
    const treeView = vscode.window.createTreeView('secureNotesTree', {
        treeDataProvider: treeProvider,
        showCollapseAll: true,
        canSelectMany: true,
        dragAndDropController: dragAndDropController
    });
    context.subscriptions.push(treeView);

    // Create command handlers
    const commands = new NotepadCommands({
        getBaseDirectory: () => treeProvider.getBaseDirectory(),
        refresh: () => treeProvider.refresh(),
        onFileMovedOrDeleted: (oldPath: string) => tempFileManager?.onFileMovedOrDeleted(oldPath)
    });

    // Register all commands
    registerCommands(context, commands, treeProvider);

    // Show welcome message if no base directory is configured
    showWelcomeMessage(treeProvider);

    logger.info('SecureNotes extension activated', 'Extension');
}

/**
 * Register all extension commands
 */
function registerCommands(
    context: vscode.ExtensionContext,
    commands: NotepadCommands,
    treeProvider: NotepadTreeProvider
): void {
    context.subscriptions.push(
        // File operations
        vscode.commands.registerCommand('secureNotes.createFile', (item) =>
            NotepadEncryption.isEnabled()
                ? createEncryptedFile(item, treeProvider)
                : commands.createFile(item)
        ),

        vscode.commands.registerCommand('secureNotes.createFolder', (item) =>
            commands.createFolder(item)
        ),

        vscode.commands.registerCommand('secureNotes.delete', (item) =>
            commands.delete(item)
        ),

        vscode.commands.registerCommand('secureNotes.rename', (item) =>
            commands.rename(item)
        ),

        vscode.commands.registerCommand('secureNotes.refresh', () =>
            treeProvider.refresh()
        ),

        vscode.commands.registerCommand('secureNotes.setBaseDirectory', () =>
            commands.setBaseDirectory()
        ),

        // Encrypted file operations
        vscode.commands.registerCommand('secureNotes.openEncrypted', async (uri: vscode.Uri) => {
            await openEncryptedFile(uri);
        }),

        // Encryption management
        vscode.commands.registerCommand('secureNotes.unlock', async () => {
            const success = await encryption.unlock();
            if (success) {
                vscode.window.showInformationMessage('Notes unlocked successfully');
                treeProvider.refresh();
            }
        }),

        vscode.commands.registerCommand('secureNotes.lock', () => {
            // Clean up temp files when locking
            if (tempFileManager) {
                tempFileManager.dispose();
                tempFileManager = new TempFileManager(encryption);
            }
            encryption.lock();
            vscode.window.showInformationMessage('Notes locked - memory cleared');
        }),

        vscode.commands.registerCommand('secureNotes.generateKeyPair', async () => {
            await generateKeyPair();
        }),

        vscode.commands.registerCommand('secureNotes.encryptDirectory', async () => {
            await encryptDirectory(treeProvider);
        }),

        vscode.commands.registerCommand('secureNotes.decryptDirectory', async () => {
            await decryptDirectory(treeProvider);
        }),

        // Debug commands (development only)
        vscode.commands.registerCommand('secureNotes.showLog', () => {
            outputChannel.show();
        })
    );
}

/**
 * Open an encrypted file using temp file in /dev/shm
 */
async function openEncryptedFile(uri: vscode.Uri): Promise<void> {
    if (!tempFileManager) {
        vscode.window.showErrorMessage(
            'Encrypted file editing requires Linux with /dev/shm support.'
        );
        return;
    }

    if (!encryption.getIsUnlocked()) {
        const unlocked = await encryption.unlock();
        if (!unlocked) {
            return;
        }
    }

    try {
        await tempFileManager.openEncryptedFile(uri.fsPath);
    } catch (error) {
        logger.error('Failed to open encrypted file', error as Error, 'Extension', { path: uri.fsPath });
        vscode.window.showErrorMessage(`Failed to open encrypted file: ${(error as Error).message}`);
    }
}

/**
 * Create a new encrypted file
 */
async function createEncryptedFile(
    item: NoteItem | undefined,
    treeProvider: NotepadTreeProvider
): Promise<void> {
    if (!tempFileManager) {
        vscode.window.showErrorMessage(
            'Encrypted file creation requires Linux with /dev/shm support.'
        );
        return;
    }

    const baseDir = treeProvider.getBaseDirectory();
    let targetDir: string;

    if (item) {
        targetDir = item.isDirectory ? item.actualPath : path.dirname(item.actualPath);
    } else if (baseDir) {
        targetDir = baseDir;
    } else {
        vscode.window.showErrorMessage('Please set a base directory first');
        return;
    }

    const fileName = await vscode.window.showInputBox({
        prompt: 'Enter the name for the new encrypted note',
        placeHolder: 'note.md',
        validateInput: (value) => {
            if (!value || value.trim() === '') {
                return 'File name cannot be empty';
            }
            return null;
        }
    });

    if (!fileName) {
        return;
    }

    // Ensure encryption is unlocked
    if (!encryption.getIsUnlocked()) {
        const unlocked = await encryption.unlock();
        if (!unlocked) {
            return;
        }
    }

    const encryptedPath = path.join(targetDir, fileName + '.enc');

    try {
        if (fs.existsSync(encryptedPath)) {
            vscode.window.showErrorMessage(`File "${fileName}" already exists`);
            return;
        }

        await tempFileManager.createEncryptedFile(encryptedPath);
        treeProvider.refresh();
    } catch (error) {
        logger.error('Failed to create encrypted file', error as Error, 'Extension', { path: encryptedPath });
        vscode.window.showErrorMessage(`Failed to create encrypted file: ${(error as Error).message}`);
    }
}

/**
 * Generate a new RSA key pair
 */
async function generateKeyPair(): Promise<void> {
    const result = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: 'Select Key Storage Location'
    });

    if (!result || !result[0]) {
        return;
    }

    const outputDir = result[0].fsPath;

    const passphrase = await vscode.window.showInputBox({
        prompt: 'Enter a passphrase to protect your private key (optional)',
        password: true,
        placeHolder: 'Leave empty for no passphrase'
    });

    try {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Generating RSA key pair...',
            cancellable: false
        }, async () => {
            const paths = await NotepadEncryption.generateKeyPair(
                outputDir,
                passphrase || undefined
            );

            // Update settings with the new key paths
            const config = vscode.workspace.getConfiguration('secureNotes');
            await config.update('encryption.publicKeyPath', paths.publicKeyPath, vscode.ConfigurationTarget.Global);
            await config.update('encryption.privateKeyPath', paths.privateKeyPath, vscode.ConfigurationTarget.Global);

            vscode.window.showInformationMessage(
                `Key pair generated!\nPublic: ${paths.publicKeyPath}\nPrivate: ${paths.privateKeyPath}`
            );
        });
    } catch (error) {
        logger.error('Failed to generate key pair', error as Error, 'Extension');
        vscode.window.showErrorMessage(`Failed to generate key pair: ${(error as Error).message}`);
    }
}

/**
 * Encrypt all files in the base directory
 */
async function encryptDirectory(treeProvider: NotepadTreeProvider): Promise<void> {
    const baseDir = treeProvider.getBaseDirectory();
    if (!baseDir) {
        vscode.window.showErrorMessage('Please set a base directory first');
        return;
    }

    const confirm = await vscode.window.showWarningMessage(
        'This will encrypt all files in your notes directory. Original files will be deleted. Continue?',
        { modal: true },
        'Encrypt All'
    );

    if (confirm !== 'Encrypt All') {
        return;
    }

    if (!encryption.getIsUnlocked()) {
        const unlocked = await encryption.unlock();
        if (!unlocked) {
            return;
        }
    }

    try {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Encrypting files...',
            cancellable: false
        }, async (progress) => {
            const files = getAllFiles(baseDir, (filePath, isDir) => {
                if (isDir) return true;
                return !filePath.endsWith('.enc');
            });

            let processed = 0;

            for (const file of files) {
                const fileName = path.basename(file);
                
                progress.report({
                    message: `${fileName}`,
                    increment: (1 / files.length) * 100
                });

                const encryptedPath = file + '.enc';
                await encryption.encryptFile(file, encryptedPath);
                fs.unlinkSync(file);
                processed++;
            }

            logger.info('Directory encrypted', 'Extension', { baseDir, fileCount: processed });
            vscode.window.showInformationMessage(`Encrypted ${processed} files`);
        });

        // Enable encryption in settings
        const config = vscode.workspace.getConfiguration('secureNotes');
        await config.update('encryption.enabled', true, vscode.ConfigurationTarget.Global);

        treeProvider.refresh();
    } catch (error) {
        logger.error('Encryption failed', error as Error, 'Extension');
        vscode.window.showErrorMessage(`Encryption failed: ${(error as Error).message}`);
    }
}

/**
 * Decrypt all files to a specified directory
 */
async function decryptDirectory(treeProvider: NotepadTreeProvider): Promise<void> {
    const baseDir = treeProvider.getBaseDirectory();
    if (!baseDir) {
        vscode.window.showErrorMessage('Please set a base directory first');
        return;
    }

    const result = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: 'Select Export Location'
    });

    if (!result || !result[0]) {
        return;
    }

    const exportDir = result[0].fsPath;

    if (!encryption.getIsUnlocked()) {
        const unlocked = await encryption.unlock();
        if (!unlocked) {
            return;
        }
    }

    try {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Decrypting files...',
            cancellable: false
        }, async (progress) => {
            const files = getAllFiles(baseDir, (filePath, isDir) => {
                if (isDir) return true;
                return filePath.endsWith('.enc');
            });

            let processed = 0;

            for (const file of files) {
                const relativePath = path.relative(baseDir, file);
                const exportPath = path.join(exportDir, relativePath.replace(/\.enc$/, ''));

                progress.report({
                    message: `${path.basename(file)}`,
                    increment: (1 / files.length) * 100
                });

                // Ensure directory exists
                const dir = path.dirname(exportPath);
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }

                const decrypted = encryption.decryptFile(file);
                fs.writeFileSync(exportPath, decrypted);
                processed++;
            }

            logger.info('Directory decrypted', 'Extension', { exportDir, fileCount: processed });
            vscode.window.showInformationMessage(`Decrypted ${processed} files to ${exportDir}`);
        });
    } catch (error) {
        logger.error('Decryption failed', error as Error, 'Extension');
        vscode.window.showErrorMessage(`Decryption failed: ${(error as Error).message}`);
    }
}

/**
 * Show welcome message if no base directory is configured
 */
function showWelcomeMessage(treeProvider: NotepadTreeProvider): void {
    const baseDir = treeProvider.getBaseDirectory();
    if (!baseDir) {
        vscode.window.showInformationMessage(
            'Welcome to SecureNotes! Set your notes directory to get started.',
            'Set Directory'
        ).then(selection => {
            if (selection === 'Set Directory') {
                vscode.commands.executeCommand('secureNotes.setBaseDirectory');
            }
        });
    }
}

/**
 * Extension deactivation
 */
export function deactivate() {
    logger.info('SecureNotes extension deactivating', 'Extension');

    // Clean up temp files
    if (tempFileManager) {
        tempFileManager.dispose();
        tempFileManager = undefined;
    }

    // Lock encryption
    if (encryption) {
        encryption.lock();
    }

    logger.info('SecureNotes extension deactivated', 'Extension');
}
