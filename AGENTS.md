# AGENTS.md

Instructions for AI agents working on this codebase.

## Project Overview

**SecureNotes** is a VS Code/Cursor extension for encrypted note-taking. It uses hybrid RSA+AES encryption with HMAC integrity verification. The core challenge is editing encrypted files securely—currently solved using Linux's `/dev/shm` RAM-based filesystem.

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
├── tempFileManager.ts     # ⚠️ Linux-only temp file handling (/dev/shm)
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

### `tempFileManager.ts` (Critical for Cross-Platform Work)

This is the **main blocker for Windows/Mac support**. It:

1. Decrypts `.enc` files to `/dev/shm` (RAM-based, Linux-only)
2. Opens the decrypted file in VS Code's native editor
3. Watches for changes and re-encrypts on save
4. Securely deletes temp files when closed

```typescript
const TEMP_BASE_PATH = '/dev/shm';  // ← Linux only!

static isAvailable(): boolean {
    return fs.existsSync(TEMP_BASE_PATH) && process.platform === 'linux';
}
```

### `encryption.ts`

Handles all cryptographic operations:
- RSA-4096 for key wrapping
- AES-256-GCM for content encryption
- HMAC-SHA256 for integrity verification
- Passphrase-protected private keys

### `fileUtils.ts`

Utility functions for:
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

## Known Limitations

| Issue | Root Cause | Potential Solutions |
|-------|-----------|---------------------|
| Linux-only encrypted editing | Uses `/dev/shm` | See "Cross-Platform Support" below |
| No tests | Project was vibe-coded | Add Jest or Vitest |
| No CI testing | Only builds, doesn't test | Add test step to workflow |

## Cross-Platform Support (TODO)

The main challenge is finding secure temporary storage on each platform:

### Windows Options

1. **DPAPI + Temp folder**: Use Windows Data Protection API to encrypt temp files
2. **In-memory editing**: Use VS Code's untitled documents (no disk write)
3. **RAM disk**: Third-party RAM disk software (not ideal for UX)
4. **VFS Provider**: Implement `FileSystemProvider` to handle files virtually

### macOS Options

1. **Encrypted APFS temp**: Create encrypted sparse image in `/tmp`
2. **Keychain + temp folder**: Store encryption key in Keychain
3. **In-memory editing**: Same as Windows option
4. **VFS Provider**: Same as Windows option

### Recommended Approach

The cleanest cross-platform solution is probably:

1. **VS Code Virtual File System (VFS)**: Implement `FileSystemProvider`
   - Files exist only in memory
   - No temp files touch disk
   - Works on all platforms
   - Challenge: Some VS Code features may not work (search, git, etc.)

2. **Platform-specific adapters**: Abstract `TempFileManager` with platform-specific implementations
   ```typescript
   interface SecureTempStorage {
       write(content: Buffer): Promise<string>;  // Returns path/URI
       read(path: string): Promise<Buffer>;
       delete(path: string): Promise<void>;
       isAvailable(): boolean;
   }
   ```

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

