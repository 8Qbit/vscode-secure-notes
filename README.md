# SecureNotes

A secure notes extension for VS Code/Cursor with end-to-end encryption support.

[![Build and Release](https://github.com/8Qbit/vscode-secure-notes/actions/workflows/build.yml/badge.svg)](https://github.com/8Qbit/vscode-secure-notes/actions/workflows/build.yml)

## Why This Exists

I've always wanted "The Perfect Note Taking App" that lives right inside my editor. Every existing extension came close but none quite scratched the itch. So one evening (fueled by mass quantities of mass-produced Finnish lager) I decided to vibe-code my own. Here we are.

What started as a simple note-taking tool evolved into something more security-focused. I got obsessed with having all notes encrypted at rest. After exploring VS Code's Virtual File System (which didn't play nice with... things), I landed on a practical approach: use your operating system's temporary storage with the best security each platform offers.

On Linux, decrypted notes live in `/dev/shm`—a RAM-based filesystem where your secrets never touch the disk. On Windows and macOS, the extension uses system temp directories with restrictive permissions. It's not perfect everywhere, but it works.

## How I Vibe-Coded?
In this project I acted as a grand orchestrator and came up with high level feature and technical ideas.

As a main AI coder I used `Claude Opus 4.5` in Cursor and as a technical reviewer I used `GPT-5.2`. I used Claude to create plans before implementation, reviewed those carefully personally and added/fixed some ideas. After each step I asked ChatGPT to review the implementation and focus on performance, security, modularity and simplicity. Then I gave the feedback back to Claude and asked it to fix all issues that had been raised during the review.

This was my first slightly larger fully vibe-coded project and all I have to say it was positive experience. The extension works "on my computer" and does what it is supposed to do.


## Features

- 📁 **File Browser** — Tree view for organizing notes in directories
- 🔐 **Per-File Encryption** — Encrypt individual files with RSA-4096 + AES-256-GCM
- 🔓 **Mixed Content** — Store encrypted and unencrypted files side by side
- 🔒 **Integrity Verification** — HMAC-SHA256 to detect tampering
- ⏱️ **Auto-Lock** — Configurable session timeout clears keys from memory
- 🖱️ **Drag & Drop** — Move files and folders naturally
- 🎨 **Theme Integration** — Follows your VS Code/Cursor theme
- 🐧 **Cross-Platform** — Works on Linux, Windows, and macOS
- 🛡️ **RAM Storage (Linux)** — Decrypted files never touch disk on Linux
- 🧪 **Tested** — Unit tests for encryption, file utilities, and storage

## Platform Security

| Platform | Temp Storage | Security Level |
|----------|--------------|----------------|
| **Linux** | `/dev/shm` (RAM-based) | 🟢 **High** — data never touches disk |
| **Windows** | `%TEMP%` | 🟡 **Medium** — on disk, user-protected |
| **macOS** | System temp | 🟡 **Medium** — on disk, user-protected |

**Recommendation**: For maximum security, use Linux. On Windows/macOS, enable disk encryption (BitLocker, FileVault) for an additional layer of protection.

## Installation

### Option 1: Download from Releases (Recommended)

1. Go to the [Releases page](https://github.com/8Qbit/vscode-secure-notes/releases)
2. Download the latest `.vsix` file
3. Install:

   ```bash
   # For Cursor
   cursor --install-extension secure-notes-*.vsix
   
   # For VS Code
   code --install-extension secure-notes-*.vsix
   ```

   Or via the UI: `Ctrl+Shift+P` → "Extensions: Install from VSIX..."

### Option 2: Build from Source

```bash
git clone https://github.com/8Qbit/vscode-secure-notes.git
cd vscode-secure-notes
npm install
npm run compile
npm install -g @vscode/vsce
vsce package --no-dependencies
cursor --install-extension secure-notes-*.vsix
```

### Option 3: Development Mode

```bash
git clone https://github.com/8Qbit/vscode-secure-notes.git
cd vscode-secure-notes
npm install
npm run compile
# Press F5 in Cursor/VS Code to launch Extension Development Host
```

## Quick Start

### 1. Set Base Directory

1. Open Command Palette (`Ctrl+Shift+P`)
2. Run `SecureNotes: Set Base Directory`
3. Select your notes folder

### 2. Generate Keys (Optional — for encryption)

If you want to encrypt files:

1. Command Palette → `SecureNotes: Generate Key Pair`
2. Choose a secure location (e.g., `~/.ssh`)
3. Optionally set a passphrase

### 3. Configure Key Paths

1. Open Settings (`Ctrl+,`)
2. Search "SecureNotes"
3. Set paths to your public and private keys

### 4. Start Using

- **Create notes**: Click the `+` icons in the sidebar
- **Encrypt a file**: Right-click → `Encrypt File`
- **Open encrypted file**: Just double-click it (🔒 icon)
- **Remove encryption**: Right-click encrypted file → `Remove Encryption`

## Commands

### Command Palette

| Command | Description |
|---------|-------------|
| `SecureNotes: Set Base Directory` | Choose notes folder |
| `SecureNotes: Generate Key Pair` | Create RSA-4096 key pair |
| `SecureNotes: Unlock Notes` | Enter passphrase to decrypt |
| `SecureNotes: Lock Notes` | Clear keys from memory |

### Context Menu (Right-Click)

| Command | Available On | Description |
|---------|--------------|-------------|
| `New Note` | Folders | Create regular file |
| `New Encrypted Note` | Folders | Create encrypted file |
| `New Folder` | Folders | Create subfolder |
| `Encrypt File` | Regular files | Encrypt existing file |
| `Remove Encryption` | 🔒 files | Permanently decrypt |
| `Rename` | Any item | Rename file/folder |
| `Delete` | Any item | Delete file/folder |

## Configuration

| Setting | Description | Default |
|---------|-------------|---------|
| `secureNotes.baseDirectory` | Notes folder path | (empty) |
| `secureNotes.encryption.publicKeyPath` | RSA public key path | (empty) |
| `secureNotes.encryption.privateKeyPath` | RSA private key path | (empty) |
| `secureNotes.encryption.sessionTimeoutMinutes` | Auto-lock after N minutes (0 = never) | `30` |

## Security Details

### Encryption Stack

| Layer | Algorithm | Purpose |
|-------|-----------|---------|
| Key Wrapping | RSA-4096 (OAEP) | Encrypts per-file AES key |
| Content | AES-256-GCM | Encrypts file data with authentication |
| Integrity | HMAC-SHA256 | Additional tamper detection |

### Secure Practices

- **Path Validation** — All operations validated to prevent directory traversal
- **Secure Deletion** — Temp files overwritten with zeros before removal
- **Memory Clearing** — Keys cleared from memory on lock
- **Permission Hardening** — Files created with `0600` permissions
- **Key Storage Warnings** — Extension warns about insecure key locations

### Encrypted File Format

```json
{
  "version": 2,
  "encryptedKey": "<RSA-encrypted AES key>",
  "iv": "<initialization vector>",
  "authTag": "<GCM authentication tag>",
  "content": "<AES-encrypted content>",
  "hmac": "<integrity hash>"
}
```

## Development

### Project Structure

```
src/
├── extension.ts           # Entry point, command registration
├── encryption.ts          # RSA+AES hybrid encryption
├── secureTempStorage.ts   # Platform-aware temp storage
├── tempFileManager.ts     # Temp file lifecycle
├── notepadTreeProvider.ts # Tree view data provider
├── notepadDragAndDrop.ts  # Drag & drop handling
├── commands.ts            # File/folder operations
├── noteItem.ts            # Tree item representation
├── fileUtils.ts           # File utilities, path validation
├── types.ts               # TypeScript interfaces
├── errors.ts              # Custom error classes
├── logger.ts              # Structured logging
└── __tests__/             # Jest unit tests
```

### Build Commands

```bash
npm run compile      # Build once
npm run watch        # Watch mode
npm run package      # Production build
npm run lint         # Run ESLint
npm test             # Run unit tests
npm run test:coverage # Tests with coverage
```

### Creating a Release

```bash
# 1. Update version in package.json
# 2. Commit and tag
git add package.json
git commit -m "Release vX.Y.Z"
git tag vX.Y.Z
git push origin main --tags
```

GitHub Actions will automatically build and create a release with the `.vsix` file.

## Troubleshooting

### Extension not appearing
- Ensure it's installed and enabled
- Reload window: `Ctrl+Shift+P` → "Developer: Reload Window"

### "Reduced security" warning on Windows/macOS
- This is expected — temp files are on disk (with permissions)
- For full security, use Linux or enable disk encryption

### Passphrase prompt not appearing
- Check that private key path is correct in settings
- Verify file permissions allow reading

### Encrypted file won't open
- Run `SecureNotes: Unlock Notes` first
- Check that key paths are configured

## Limitations

- **Disk temp on Windows/macOS** — Decrypted files touch disk (permissions-protected)
- **Secure delete best-effort** — SSDs/journaling filesystems may retain data
- **No cloud sync** — Extension doesn't sync notes (use your own solution)

## Roadmap

- [ ] VS Code Virtual File System for true in-memory editing
- [ ] "Encrypt on create" toggle setting
- [ ] VS Code Marketplace publishing
- [x] ~~Windows support~~ — v2.0.0
- [x] ~~macOS support~~ — v2.0.0
- [x] ~~Unit tests~~ — v2.0.0

## License

MIT
