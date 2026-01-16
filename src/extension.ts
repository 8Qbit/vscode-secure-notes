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
import { AutoSaveManager } from './autoSaveManager';
import { NoteItem } from './noteItem';
import { logger, LogLevel } from './logger';
import { 
    validateFileName, 
    validatePathWithinBase, 
    validateNewPathWithinBase,
    PathSecurityError 
} from './fileUtils';

/**
 * Paths that are potentially insecure for storing private keys.
 * These are shared, temporary, or commonly synced locations.
 */
const INSECURE_KEY_PATHS = [
    '/tmp',
    '/var/tmp',
    '/dev/shm',
    '/mnt/c/Users/Public',
    '/mnt/d/Users/Public',
];

/**
 * Check if a path is potentially insecure for storing private keys.
 */
function isInsecureKeyLocation(dirPath: string): boolean {
    const normalized = path.resolve(dirPath).toLowerCase();
    
    // Check against known insecure paths
    for (const insecure of INSECURE_KEY_PATHS) {
        if (normalized.startsWith(insecure.toLowerCase())) {
            return true;
        }
    }
    
    // Check for common cloud sync folders
    const cloudIndicators = ['dropbox', 'onedrive', 'google drive', 'icloud', 'box sync'];
    for (const indicator of cloudIndicators) {
        if (normalized.includes(indicator)) {
            return true;
        }
    }
    
    return false;
}

// Global state
let encryption: NotepadEncryption;
let tempFileManager: TempFileManager | undefined;
let autoSaveManager: AutoSaveManager | undefined;
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

    // Initialize temp file manager
    // Now supports multiple platforms with varying security levels
    tempFileManager = new TempFileManager(encryption);
    const storageInfo = TempFileManager.getStorageInfo();
    
    logger.info('Secure temp storage initialized', 'Extension', {
        platform: storageInfo.platform,
        securityLevel: storageInfo.securityLevel
    });

    // Show platform-specific security information
    if (storageInfo.securityLevel === 'high') {
        logger.info('Using RAM-based storage - maximum security', 'Extension');
    } else if (storageInfo.securityLevel === 'medium') {
        // Show one-time warning about reduced security on Windows/macOS
        const warningKey = 'secureNotes.shownTempStorageWarning';
        if (!context.globalState.get(warningKey)) {
            vscode.window.showWarningMessage(
                `SecureNotes: On ${process.platform}, decrypted files are temporarily stored on disk ` +
                `(with restricted permissions). For maximum security, use Linux with /dev/shm.`,
                'Got it'
            ).then(() => {
                context.globalState.update(warningKey, true);
            });
        }
    }

    // Create tree data provider
    const treeProvider = new NotepadTreeProvider();
    context.subscriptions.push(treeProvider);

    // Create drag and drop controller
    const dragAndDropController = new NotepadDragAndDropController(
        () => treeProvider.getBaseDirectory(),
        () => treeProvider.refresh(),
        {
            saveAndCloseBeforeMove: (encryptedPath: string) => 
                tempFileManager?.saveAndCloseBeforeMove(encryptedPath) ?? Promise.resolve(true),
            isOpenWithUnsavedChanges: (encryptedPath: string) => 
                tempFileManager?.isOpenWithUnsavedChanges(encryptedPath) ?? false
        }
    );

    // Register tree view
    const treeView = vscode.window.createTreeView('secureNotesTree', {
        treeDataProvider: treeProvider,
        showCollapseAll: true,
        canSelectMany: true,
        dragAndDropController: dragAndDropController
    });
    context.subscriptions.push(treeView);

    // Initialize autosave manager
    autoSaveManager = new AutoSaveManager(
        () => treeProvider.getBaseDirectory(),
        () => tempFileManager?.getAllTempPaths() ?? []
    );
    context.subscriptions.push(autoSaveManager);

    logger.info('AutoSaveManager initialized', 'Extension', {
        enabled: autoSaveManager.isEnabled(),
        delaySeconds: autoSaveManager.getDelaySeconds()
    });

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
            commands.createFile(item)
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

        // Per-file encryption commands
        vscode.commands.registerCommand('secureNotes.encryptFile', async (item: NoteItem) => {
            await encryptSingleFile(item, treeProvider);
        }),

        vscode.commands.registerCommand('secureNotes.decryptFile', async (item: NoteItem) => {
            await decryptSingleFile(item, treeProvider);
        }),

        vscode.commands.registerCommand('secureNotes.createEncryptedFile', async (item: NoteItem | undefined) => {
            await createEncryptedFile(item, treeProvider);
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
    if (!baseDir) {
        vscode.window.showErrorMessage('Please set a base directory first');
        return;
    }

    let targetDir: string;

    if (item) {
        targetDir = item.isDirectory ? item.actualPath : path.dirname(item.actualPath);
    } else {
        targetDir = baseDir;
    }

    // SECURITY: Validate target directory is within notes directory
    try {
        validatePathWithinBase(targetDir, baseDir);
    } catch (error) {
        if (error instanceof PathSecurityError) {
            logger.error('Security violation in createEncryptedFile', error as Error, 'Extension', { 
                targetDir, 
                baseDir 
            });
            vscode.window.showErrorMessage('Cannot create file: path is outside notes directory');
            return;
        }
        throw error;
    }

    const fileName = await vscode.window.showInputBox({
        prompt: 'Enter the name for the new encrypted note',
        placeHolder: 'note.md',
        validateInput: validateFileName
    });

    if (!fileName) {
        return;
    }

    const encryptedPath = path.join(targetDir, fileName + '.enc');

    // SECURITY: Validate final path is within notes directory
    try {
        validateNewPathWithinBase(encryptedPath, baseDir);
    } catch (error) {
        if (error instanceof PathSecurityError) {
            logger.error('Security violation in createEncryptedFile (final path)', error as Error, 'Extension', { 
                encryptedPath, 
                baseDir 
            });
            vscode.window.showErrorMessage('Cannot create file: path is outside notes directory');
            return;
        }
        throw error;
    }

    // Ensure encryption is unlocked
    if (!encryption.getIsUnlocked()) {
        const unlocked = await encryption.unlock();
        if (!unlocked) {
            return;
        }
    }

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
 * Check if a file is open with unsaved changes and prompt user to save.
 * Returns true if safe to proceed, false if user cancelled.
 */
async function ensureFileSaved(filePath: string): Promise<boolean> {
    const doc = vscode.workspace.textDocuments.find(d => d.uri.fsPath === filePath);
    
    if (doc && doc.isDirty) {
        const choice = await vscode.window.showWarningMessage(
            `"${path.basename(filePath)}" has unsaved changes.`,
            { modal: true },
            'Save and Continue',
            'Cancel'
        );
        
        if (choice === 'Save and Continue') {
            await doc.save();
            return true;
        }
        return false;
    }
    return true;
}

/**
 * Encrypt a single file
 */
async function encryptSingleFile(
    item: NoteItem,
    treeProvider: NotepadTreeProvider
): Promise<void> {
    if (!item || item.isDirectory || item.isEncrypted) {
        vscode.window.showErrorMessage('Please select a file to encrypt');
        return;
    }

    const baseDir = treeProvider.getBaseDirectory();
    if (!baseDir) {
        vscode.window.showErrorMessage('Please set a base directory first');
        return;
    }

    // SECURITY: Validate source file is within notes directory
    try {
        validatePathWithinBase(item.actualPath, baseDir);
    } catch (error) {
        if (error instanceof PathSecurityError) {
            logger.error('Security violation in encryptSingleFile', error as Error, 'Extension', {
                path: item.actualPath,
                baseDir
            });
            vscode.window.showErrorMessage('Cannot encrypt file: path is outside notes directory');
            return;
        }
        throw error;
    }

    // Check if file has unsaved changes
    if (!await ensureFileSaved(item.actualPath)) {
        return;
    }

    const confirm = await vscode.window.showWarningMessage(
        `Encrypt "${path.basename(item.actualPath)}"?\n\nThe original file will be replaced with an encrypted version.`,
        { modal: true },
        'Encrypt'
    );

    if (confirm !== 'Encrypt') {
        return;
    }

    if (!encryption.getIsUnlocked()) {
        const unlocked = await encryption.unlock();
        if (!unlocked) {
            return;
        }
    }

    try {
        const encryptedPath = item.actualPath + '.enc';
        
        // SECURITY: Validate destination path is within notes directory
        validateNewPathWithinBase(encryptedPath, baseDir);
        
        await encryption.encryptFile(item.actualPath, encryptedPath);
        fs.unlinkSync(item.actualPath);
        
        logger.info('File encrypted', 'Extension', { path: item.actualPath });
        vscode.window.showInformationMessage(`File encrypted: ${path.basename(item.actualPath)}`);
        treeProvider.refresh();
    } catch (error) {
        if (error instanceof PathSecurityError) {
            logger.error('Security violation in encryptSingleFile (dest)', error as Error, 'Extension');
            vscode.window.showErrorMessage('Cannot encrypt file: destination path is outside notes directory');
            return;
        }
        logger.error('Failed to encrypt file', error as Error, 'Extension', { path: item.actualPath });
        vscode.window.showErrorMessage(`Failed to encrypt file: ${(error as Error).message}`);
    }
}

/**
 * Permanently decrypt a file (remove encryption)
 */
async function decryptSingleFile(
    item: NoteItem,
    treeProvider: NotepadTreeProvider
): Promise<void> {
    if (!item || item.isDirectory || !item.isEncrypted) {
        vscode.window.showErrorMessage('Please select an encrypted file to decrypt');
        return;
    }

    const baseDir = treeProvider.getBaseDirectory();
    if (!baseDir) {
        vscode.window.showErrorMessage('Please set a base directory first');
        return;
    }

    // SECURITY: Validate source file is within notes directory
    try {
        validatePathWithinBase(item.actualPath, baseDir);
    } catch (error) {
        if (error instanceof PathSecurityError) {
            logger.error('Security violation in decryptSingleFile', error as Error, 'Extension', {
                path: item.actualPath,
                baseDir
            });
            vscode.window.showErrorMessage('Cannot decrypt file: path is outside notes directory');
            return;
        }
        throw error;
    }

    // Check if the temp file (if open) has unsaved changes
    const tempPath = tempFileManager?.getTempPath(item.actualPath);
    if (tempPath && !await ensureFileSaved(tempPath)) {
        return;
    }

    const displayName = path.basename(item.actualPath).replace(/\.enc$/, '');
    const confirm = await vscode.window.showWarningMessage(
        `Remove encryption from "${displayName}"?\n\nThe file will be stored as unencrypted plain text.`,
        { modal: true },
        'Remove Encryption'
    );

    if (confirm !== 'Remove Encryption') {
        return;
    }

    if (!encryption.getIsUnlocked()) {
        const unlocked = await encryption.unlock();
        if (!unlocked) {
            return;
        }
    }

    try {
        const decryptedPath = item.actualPath.replace(/\.enc$/, '');
        
        // SECURITY: Validate destination path is within notes directory
        validateNewPathWithinBase(decryptedPath, baseDir);
        
        if (fs.existsSync(decryptedPath)) {
            vscode.window.showErrorMessage(`Cannot decrypt: "${displayName}" already exists as an unencrypted file`);
            return;
        }

        const decrypted = encryption.decryptFile(item.actualPath);
        fs.writeFileSync(decryptedPath, decrypted, { mode: 0o600 });
        fs.unlinkSync(item.actualPath);

        // Clean up any temp file for this encrypted file
        tempFileManager?.onFileMovedOrDeleted(item.actualPath);
        
        logger.info('File decrypted', 'Extension', { path: item.actualPath, decryptedPath });
        vscode.window.showInformationMessage(`Encryption removed: ${displayName}`);
        treeProvider.refresh();
    } catch (error) {
        if (error instanceof PathSecurityError) {
            logger.error('Security violation in decryptSingleFile (dest)', error as Error, 'Extension');
            vscode.window.showErrorMessage('Cannot decrypt file: destination path is outside notes directory');
            return;
        }
        logger.error('Failed to decrypt file', error as Error, 'Extension', { path: item.actualPath });
        vscode.window.showErrorMessage(`Failed to decrypt file: ${(error as Error).message}`);
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
        openLabel: 'Select Key Storage Location',
        title: 'Select a SECURE location for your encryption keys'
    });

    if (!result || !result[0]) {
        return;
    }

    const outputDir = result[0].fsPath;

    // Security check: warn about insecure locations
    if (isInsecureKeyLocation(outputDir)) {
        const proceed = await vscode.window.showWarningMessage(
            '⚠️ SECURITY WARNING: The selected location may not be secure for storing private keys.\n\n' +
            'Avoid storing keys in:\n' +
            '• Temporary folders (/tmp)\n' +
            '• Cloud-synced folders (Dropbox, OneDrive, etc.)\n' +
            '• Shared/public locations\n\n' +
            'Consider using ~/.ssh or another private, local directory.',
            { modal: true },
            'Use Anyway',
            'Choose Different Location'
        );

        if (proceed !== 'Use Anyway') {
            // Let user try again
            return generateKeyPair();
        }
    }

    const passphrase = await vscode.window.showInputBox({
        prompt: 'Enter a passphrase to protect your private key (recommended)',
        password: true,
        placeHolder: 'Leave empty for no passphrase (less secure)'
    });

    // Warn if no passphrase is set
    if (!passphrase) {
        const proceed = await vscode.window.showWarningMessage(
            '⚠️ No passphrase set. Your private key will be stored unencrypted.\n\n' +
            'Anyone with access to the key file can decrypt your notes.',
            { modal: true },
            'Continue Without Passphrase',
            'Set Passphrase'
        );

        if (proceed === 'Set Passphrase') {
            return generateKeyPair();
        }
        if (proceed !== 'Continue Without Passphrase') {
            return;
        }
    }

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

    // Clean up autosave manager
    if (autoSaveManager) {
        autoSaveManager.dispose();
        autoSaveManager = undefined;
    }

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
