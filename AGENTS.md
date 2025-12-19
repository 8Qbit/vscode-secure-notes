# AGENTS.md

Instructions for AI agents working on this codebase.

## Project Overview

**SecureNotes** is a VS Code/Cursor extension for note-taking with optional per-file encryption. It uses hybrid RSA+AES encryption with HMAC integrity verification. The extension supports mixed content (encrypted and unencrypted files side by side). Editing encrypted files uses platform-specific secure temp storage (Linux `/dev/shm`, Windows/macOS temp directories).

## Tech Stack

- **Language**: TypeScript
- **Platform**: VS Code Extension API
- **Build**: esbuild (fast, single-file bundle)
- **Encryption**: Node.js `crypto` module (RSA-4096, AES-256-GCM, HMAC-SHA256)

## Architecture

```
src/
├── extension.ts           # Entry point, command registration, lifecycle
├── encryption.ts          # Hybrid encryption (RSA key wrap + AES-GCM)
├── tempFileManager.ts     # Cross-platform temp file handling
├── secureTempStorage.ts   # Platform-aware secure storage abstraction
├── notepadTreeProvider.ts # Tree view data provider
├── commands.ts            # Command handlers (create, delete, rename, etc.)
├── notepadDragAndDrop.ts  # Drag & drop controller
├── noteItem.ts            # Tree item representation
├── types.ts               # TypeScript interfaces
├── errors.ts              # Structured error types
├── logger.ts              # Logging module
└── fileUtils.ts           # File operations, secure delete, permissions
```

## Key Files to Understand

### `secureTempStorage.ts` (Platform Abstraction)

Provides platform-aware secure temporary storage:

| Platform | Storage | Security Level |
|----------|---------|----------------|
| Linux | `/dev/shm` (RAM-based) | High - never touches disk |
| Windows | `%TEMP%` | Medium - on disk but user-protected |
| macOS | System temp | Medium - on disk but user-protected |

```typescript
export type SecurePlatform = 'linux-shm' | 'windows-temp' | 'macos-temp' | 'fallback';
```

### `tempFileManager.ts`

Uses `SecureTempStorage` to:

1. Decrypts `.enc` files to platform-appropriate temp storage
2. Opens the decrypted file in VS Code's native editor
3. Watches for changes and re-encrypts on save
4. Securely deletes temp files when closed

### `encryption.ts`

Handles all cryptographic operations:
- RSA-4096 for key wrapping
- AES-256-GCM for content encryption
- HMAC-SHA256 for integrity verification
- Passphrase-protected private keys

### `fileUtils.ts`

**Security-critical utility functions**:
- `validatePathWithinBase()` - Prevents command injection (uses realpath to handle symlinks)
- `validateNewPathWithinBase()` - Same, for paths that don't exist yet
- `validateFileName()` - Prevents path traversal in user input
- `PathSecurityError` - Thrown when path validation fails

Other utilities:
- Secure file deletion (zero-overwrite before delete)
- Secure directory creation (mode 0700)
- Debounced file handlers

## Development Workflow

```bash
npm install          # Install dependencies
npm run compile      # Build once
npm run watch        # Watch mode for development
npm run lint         # Run ESLint
npm run package      # Production build (minified)
```

**Testing**: Press F5 in VS Code/Cursor to launch Extension Development Host.

## Code Conventions

1. **Structured Logging**: Use the logger module, not `console.log`
2. **Error Classes**: Use custom errors from `errors.ts` for user-facing issues
3. **Dispose Pattern**: Implement `vscode.Disposable` for cleanup
4. **File Permissions**: Use constants from `fileUtils.ts` (e.g., `SECURE_FILE_PERMISSIONS.PRIVATE`)

## Per-File Encryption Model

The extension uses per-file encryption rather than directory-wide encryption:

- **Mixed content**: Users can have encrypted (`.enc`) and unencrypted files in the same folder
- **Encrypt File**: Right-click a regular file to encrypt it (replaces original)
- **Remove Encryption**: Right-click an encrypted file to permanently decrypt it
- **Create Encrypted File**: Create a new file that's encrypted from the start
- **Visual indicator**: Encrypted files show a 🔒 icon in the tree view

This approach is more flexible and less risky than bulk encryption operations.

## Critical Security Measures

### Command Injection Prevention (P0)

**CRITICAL**: All file operations validate that paths are within the notes directory.

```typescript
// From fileUtils.ts - used by ALL file operations
validatePathWithinBase(targetPath, baseDir);  // Throws PathSecurityError if outside
validateNewPathWithinBase(newPath, baseDir);  // For paths that don't exist yet
```

This prevents attacks where malicious extensions call commands like:
```typescript
// BLOCKED - would throw PathSecurityError
vscode.commands.executeCommand('secureNotes.delete', { actualPath: '/etc/passwd' });
```

Protected operations:
- `delete()` - validates item.actualPath
- `rename()` - validates both old and new paths
- `createFile()` / `createFolder()` - validates target directory and final path
- `moveItem()` (drag/drop) - validates source, target, and destination paths
- `createEncryptedFile()` - validates target directory and final path

### Save/Close Race Condition Prevention (P0)

`TempFileManager` now uses `cleanupTempFileAsync()` which:
1. Waits for any in-progress save to complete
2. Forces a final re-encrypt before cleanup
3. Listens to `onDidSaveTextDocument` for immediate saves (bypasses debounce)

### Path Traversal Prevention
All file/folder name inputs are validated with `validateFileName()` (from `fileUtils.ts`) which blocks:
- Path separators (`/`, `\`)
- Path traversal patterns (`..`, `.`)
- Null bytes (`\0`)

### Encrypted File Permissions (P1)
All `.enc` files are written with mode `0o600` (owner read/write only):
```typescript
fs.writeFileSync(destPath, JSON.stringify(encrypted, null, 2), { 
    mode: SECURE_FILE_PERMISSIONS.PRIVATE 
});
```

### Key Storage Warnings
`generateKeyPair()` warns users about insecure locations:
- Temporary folders (`/tmp`, `/var/tmp`)
- Cloud-synced folders (Dropbox, OneDrive, Google Drive, iCloud)
- Shared/public directories

It also warns if no passphrase is set for the private key.

### Private Key Permission Check
On Linux/macOS, `loadPrivateKey()` **blocks** loading if the private key file has insecure permissions (anything other than 600). Users must fix permissions with `chmod 600`.

## Known Limitations

| Issue | Root Cause | Potential Solutions |
|-------|-----------|---------------------|
| Windows/macOS temp files on disk | No RAM-based filesystem | VFS provider, or rely on disk encryption |
| ~No tests~ | **FIXED**: Jest tests added | See `src/__tests__/` |
| ~No CI testing~ | **FIXED**: Tests run in GitHub Actions | See `.github/workflows/build.yml` |

## Cross-Platform Support (Implemented)

The extension now supports all major platforms via `SecureTempStorage`:

| Platform | Implementation | Security |
|----------|---------------|----------|
| Linux | `/dev/shm` | ✅ RAM-based, never touches disk |
| Windows | `%TEMP%` + 0600 permissions | ⚠️ On disk, user-protected |
| macOS | System temp + 0600 permissions | ⚠️ On disk, user-protected |

### Future Improvement: VS Code VFS

For maximum security on all platforms, implement `FileSystemProvider`:
- Files exist only in memory
- No temp files touch disk
- Works on all platforms
- Challenge: Some VS Code features may not work (search, git, etc.)

## File Format

Encrypted files use JSON (version 2):

```json
{
  "version": 2,
  "encryptedKey": "<base64 RSA-encrypted AES key>",
  "iv": "<base64 initialization vector>",
  "authTag": "<base64 GCM authentication tag>",
  "content": "<base64 AES-encrypted content>",
  "hmac": "<base64 HMAC for integrity>"
}
```

## Common Tasks

### Adding a New Command

1. Add command to `package.json` under `contributes.commands`
2. Add menu entry if needed under `contributes.menus`
3. Implement handler in `commands.ts`
4. Register in `extension.ts`

### Modifying Encryption

Be extremely careful. The encryption module handles:
- Key derivation from passphrase
- Hybrid encryption (RSA wraps AES key)
- HMAC for tamper detection

Any changes must maintain backward compatibility with existing `.enc` files.

## Useful VS Code APIs

- `vscode.workspace.createFileSystemWatcher()` - Watch file changes
- `vscode.window.tabGroups` - Manage editor tabs
- `vscode.workspace.registerFileSystemProvider()` - VFS for cross-platform
- `vscode.SecretStorage` - Store secrets (could replace key file approach)

## Questions? 

Check the README for user-facing documentation. For implementation details, the code is well-commented.

