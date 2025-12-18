import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { NotepadTreeProvider } from './notepadTreeProvider';
import { NotepadCommands } from './commands';
import { NotepadDragAndDropController } from './notepadDragAndDrop';
import { NotepadEncryption } from './encryption';
import { TempFileManager } from './tempFileManager';
import { NoteItem } from './noteItem';

let encryption: NotepadEncryption;
let tempFileManager: TempFileManager | undefined;

export function activate(context: vscode.ExtensionContext) {
    console.log('SecureNotes extension is now active');

    // Initialize encryption components
    encryption = new NotepadEncryption();

    // Check if /dev/shm is available (Linux)
    if (TempFileManager.isAvailable()) {
        tempFileManager = new TempFileManager(encryption);
        console.log('SecureNotes: Using /dev/shm for secure temp files');
    } else {
        console.log('SecureNotes: /dev/shm not available, encrypted editing disabled');
        vscode.window.showWarningMessage(
            'SecureNotes: /dev/shm is not available. Encrypted file editing requires Linux with /dev/shm.'
        );
    }

    // Create the tree data provider
    const treeProvider = new NotepadTreeProvider();

    // Create drag and drop controller
    const dragAndDropController = new NotepadDragAndDropController(
        () => treeProvider.getBaseDirectory(),
        () => treeProvider.refresh(),
        (oldPath: string) => tempFileManager?.onFileMovedOrDeleted(oldPath)
    );

    // Register the tree view with drag and drop support
    const treeView = vscode.window.createTreeView('secureNotesTree', {
        treeDataProvider: treeProvider,
        showCollapseAll: true,
        canSelectMany: true,
        dragAndDropController: dragAndDropController
    });

    // Create command handlers
    const commands = new NotepadCommands(
        () => treeProvider.getBaseDirectory(),
        () => treeProvider.refresh(),
        (oldPath: string) => tempFileManager?.onFileMovedOrDeleted(oldPath)
    );

    // Register commands
    context.subscriptions.push(
        treeView,
        treeProvider,

        // Basic file operations
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

        // Open encrypted file
        vscode.commands.registerCommand('secureNotes.openEncrypted', async (uri: vscode.Uri) => {
            await openEncryptedFile(uri);
        }),

        // Encryption commands
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
        })
    );

    // Show welcome message if no base directory is configured
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
        vscode.window.showErrorMessage(`Failed to open encrypted file: ${(error as Error).message}`);
    }
}

/**
 * Create a new encrypted file
 */
async function createEncryptedFile(item: NoteItem | undefined, treeProvider: NotepadTreeProvider): Promise<void> {
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
        placeHolder: 'note.md'
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

        // Create and open the encrypted file
        await tempFileManager.createEncryptedFile(encryptedPath);
        treeProvider.refresh();
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to create encrypted file: ${(error as Error).message}`);
    }
}

/**
 * Generate a new RSA key pair
 */
async function generateKeyPair(): Promise<void> {
    // Ask where to save the keys
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

    // Ask for optional passphrase
    const passphrase = await vscode.window.showInputBox({
        prompt: 'Enter a passphrase to protect your private key (optional)',
        password: true,
        placeHolder: 'Leave empty for no passphrase'
    });

    try {
        vscode.window.withProgress({
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

    // Ensure encryption is unlocked
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
            const files = getAllFiles(baseDir);
            let processed = 0;

            for (const file of files) {
                const fileName = path.basename(file);
                if (fileName.endsWith('.enc')) {
                    continue; // Skip already encrypted files
                }

                progress.report({ 
                    message: `${fileName}`,
                    increment: (1 / files.length) * 100
                });

                const encryptedPath = file + '.enc';
                await encryption.encryptFile(file, encryptedPath);
                fs.unlinkSync(file); // Delete original
                processed++;
            }

            vscode.window.showInformationMessage(`Encrypted ${processed} files`);
        });

        // Enable encryption in settings
        const config = vscode.workspace.getConfiguration('secureNotes');
        await config.update('encryption.enabled', true, vscode.ConfigurationTarget.Global);
        
        treeProvider.refresh();
    } catch (error) {
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

    // Ask where to export decrypted files
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

    // Ensure encryption is unlocked
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
            const files = getAllFiles(baseDir).filter(f => f.endsWith('.enc'));
            let processed = 0;

            for (const file of files) {
                const relativePath = path.relative(baseDir, file);
                // Remove .enc suffix to get the original path
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

            vscode.window.showInformationMessage(`Decrypted ${processed} files to ${exportDir}`);
        });
    } catch (error) {
        vscode.window.showErrorMessage(`Decryption failed: ${(error as Error).message}`);
    }
}

/**
 * Get all files in a directory recursively
 */
function getAllFiles(dirPath: string): string[] {
    const files: string[] = [];
    
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
        if (entry.name.startsWith('.')) {
            continue;
        }

        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            files.push(...getAllFiles(fullPath));
        } else {
            files.push(fullPath);
        }
    }

    return files;
}

export function deactivate() {
    // Clean up temp files
    if (tempFileManager) {
        tempFileManager.dispose();
        tempFileManager = undefined;
    }

    if (encryption) {
        encryption.lock();
    }

    console.log('SecureNotes extension is now deactivated');
}
