# PROJECT_CONTEXT.md

Quick-reference for AI agents. Token-optimized.

## Purpose

VS Code/Cursor extension for secure note-taking with **per-file hybrid encryption** (RSA-4096 + AES-256-GCM + HMAC-SHA256). Supports mixed encrypted/unencrypted content. Uses platform-specific secure temp storage for editing encrypted files.

## Tech Stack

| Component | Technology |
|-----------|------------|
| Language | TypeScript (strict) |
| Platform | VS Code Extension API (^1.85.0) |
| Build | esbuild (single-file bundle) |
| Test | Jest + ts-jest |
| Encryption | Node.js `crypto` module |

**No runtime dependencies** — uses only VS Code API and Node.js built-ins.

## Architecture

```
src/
├── extension.ts           # Entry point, command registration, lifecycle
├── encryption.ts          # Hybrid encryption (RSA key wrap + AES-GCM + HMAC)
├── tempFileManager.ts     # Decrypts to temp → edit → re-encrypt on save
├── secureTempStorage.ts   # Platform abstraction (Linux /dev/shm, Win/macOS temp)
├── notepadTreeProvider.ts # TreeDataProvider for file browser
├── commands.ts            # Command handlers (create, delete, rename)
├── notepadDragAndDrop.ts  # TreeDragAndDropController
├── noteItem.ts            # TreeItem subclass
├── autoSaveManager.ts     # Debounced autosave for open documents
├── types.ts               # TypeScript interfaces
├── errors.ts              # Structured error classes with user messages
├── logger.ts              # Logging abstraction
└── fileUtils.ts           # Path validation, secure delete, permissions

src/__tests__/             # Jest unit tests
├── encryption.test.ts
├── fileUtils.test.ts
├── secureTempStorage.test.ts
└── autoSaveManager.test.ts
```

## Key Abstractions

| Class/Module | Responsibility |
|--------------|----------------|
| `NotepadEncryption` | RSA key loading, encrypt/decrypt, session timeout |
| `TempFileManager` | Lifecycle of decrypted temp files, save detection, cleanup |
| `SecureTempStorage` | Platform detection, secure file I/O, secure delete |
| `NotepadTreeProvider` | File tree state, refresh, base directory |
| `NotepadCommands` | All file CRUD operations with path validation |
| `PathSecurityError` | Thrown when path escapes base directory |

## Data Flow

### Opening Encrypted File

```
1. User double-clicks .enc file
2. extension.ts → tempFileManager.openEncryptedFile()
3. encryption.decryptFile() → returns Buffer
4. secureTempStorage.writeSecureFile() → temp path
5. vscode.window.showTextDocument(tempPath)
6. FileSystemWatcher + onDidSaveTextDocument → triggers re-encrypt
7. On tab close → cleanupTempFileAsync() → secure delete
```

### Encryption Flow

```
plaintext → AES-256-GCM(randomKey, iv) → ciphertext
randomKey → RSA-OAEP(publicKey) → encryptedKey
ciphertext → HMAC-SHA256(randomKey) → hmac
Output: { version, encryptedKey, iv, authTag, content, hmac }
```

### Security Validation

```
All file ops → validatePathWithinBase(path, baseDir)
             → fs.realpathSync() to resolve symlinks
             → throws PathSecurityError if outside
```

## Conventions

### Code Style
- **Logging**: Use `logger.info/debug/error()` — never `console.log`
- **Errors**: Use custom classes from `errors.ts` with user messages
- **Cleanup**: Implement `vscode.Disposable` for resource cleanup
- **Permissions**: Use `SECURE_FILE_PERMISSIONS.PRIVATE` (0o600)

### File Naming
- Source: `camelCase.ts`
- Tests: `*.test.ts` in `__tests__/`
- Encrypted files: `*.enc` (JSON format)

### Error Handling Pattern
```typescript
try {
    validatePathWithinBase(targetPath, baseDir);
    // ... operation
} catch (error) {
    if (error instanceof PathSecurityError) {
        logger.error('Security violation', error, 'Context');
        vscode.window.showErrorMessage('Path is outside notes directory');
        return;
    }
    throw error;
}
```

## Config Keys

| Setting | Type | Default |
|---------|------|---------|
| `secureNotes.baseDirectory` | string | "" |
| `secureNotes.encryption.publicKeyPath` | string | "" |
| `secureNotes.encryption.privateKeyPath` | string | "" |
| `secureNotes.encryption.sessionTimeoutMinutes` | number | 30 |
| `secureNotes.autosave.enabled` | boolean | true |
| `secureNotes.autosave.delaySeconds` | number | 5 |

## Commands

| Command ID | Trigger |
|------------|---------|
| `secureNotes.setBaseDirectory` | Command palette |
| `secureNotes.generateKeyPair` | Command palette |
| `secureNotes.unlock` / `lock` | Command palette + toolbar |
| `secureNotes.createFile` / `createFolder` | Context menu + toolbar |
| `secureNotes.createEncryptedFile` | Context menu |
| `secureNotes.encryptFile` / `decryptFile` | Context menu |
| `secureNotes.rename` / `delete` | Context menu |

## Platform Behavior

| Platform | Temp Storage | Security |
|----------|--------------|----------|
| Linux | `/dev/shm` | 🟢 RAM-based, never on disk |
| Windows | `%TEMP%` | 🟡 Disk, 0600 permissions |
| macOS | System temp | 🟡 Disk, 0600 permissions |

## Critical Invariants

1. **Path validation**: Every file operation calls `validatePathWithinBase()` or `validateNewPathWithinBase()`
2. **Permission enforcement**: Private key must be 0600 on Unix (loading blocked otherwise)
3. **Integrity check**: Decrypt verifies HMAC before returning content
4. **Cleanup guarantee**: `cleanupTempFileAsync()` waits for pending saves before deletion
5. **File format stability**: Version 2 format must remain backwards compatible
