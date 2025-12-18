# SecureNotes

A secure notes extension for VS Code/Cursor with encrypted storage using RSA+AES hybrid encryption.

## Features

- **Directory Tree View**: Shows your notes folder in a dedicated Activity Bar panel with a shield icon
- **Full CRUD Operations**: Create, rename, and delete files and folders
- **Drag & Drop**: Move files and folders by dragging
- **Auto-refresh**: Tree automatically updates when files change
- **Click to Open**: Single-click on any file to open it in the editor

### Encryption Features

- **Hybrid Encryption**: Uses AES-256-GCM for content + RSA for key encryption
- **In-Memory Only**: Decrypted content never touches the disk
- **Custom Editor**: Encrypted files open in a secure custom editor
- **Key Management**: Generate RSA key pairs directly from VS Code
- **Passphrase Protection**: Optional passphrase for private key

## Usage

### Basic Setup

1. Install the extension
2. Click the **shield icon** in the Activity Bar
3. Run **"SecureNotes: Set Base Directory"** from the Command Palette
4. Select your notes folder

### Setting Up Encryption

1. Run **"SecureNotes: Generate Key Pair"** to create RSA keys
2. Choose a secure location for the keys
3. Optionally set a passphrase for the private key
4. The key paths will be automatically configured

Or manually configure in settings:

```json
{
  "secureNotes.baseDirectory": "/path/to/notes",
  "secureNotes.encryption.enabled": true,
  "secureNotes.encryption.publicKeyPath": "/path/to/notepad_public.pem",
  "secureNotes.encryption.privateKeyPath": "/path/to/notepad_private.pem"
}
```

### Encrypting Existing Notes

1. Configure your keys (see above)
2. Run **"SecureNotes: Encrypt All Notes"**
3. Confirm the operation
4. All files will be encrypted and originals deleted

### Working with Encrypted Notes

1. Click on an encrypted note (shows lock icon)
2. Enter your private key passphrase when prompted
3. Edit the note in the secure editor
4. Save with `Ctrl+S` - content is encrypted automatically

### Exporting Decrypted Notes

1. Run **"SecureNotes: Export Decrypted Notes"**
2. Select a destination folder
3. All notes will be decrypted to that location

### Locking Notes

- Run **"SecureNotes: Lock Notes"** to clear all decrypted content from memory
- Or click the lock icon in the SecureNotes view title bar

## Commands

| Command | Description |
|---------|-------------|
| `SecureNotes: Set Base Directory` | Select notes directory |
| `SecureNotes: Generate Key Pair` | Create new RSA keys |
| `SecureNotes: Encrypt All Notes` | Encrypt existing files |
| `SecureNotes: Export Decrypted Notes` | Decrypt files to a folder |
| `SecureNotes: Unlock Notes` | Enter passphrase to decrypt |
| `SecureNotes: Lock Notes` | Clear memory and lock |

## Settings

| Setting | Description | Default |
|---------|-------------|---------|
| `secureNotes.baseDirectory` | Base directory for notes | `""` |
| `secureNotes.encryption.enabled` | Enable encryption mode | `false` |
| `secureNotes.encryption.publicKeyPath` | Path to RSA public key (PEM) | `""` |
| `secureNotes.encryption.privateKeyPath` | Path to RSA private key (PEM) | `""` |

## Security Details

### Encryption Scheme

- **Symmetric**: AES-256-GCM (authenticated encryption)
- **Asymmetric**: RSA-OAEP with SHA-256 (4096-bit keys)
- **File Format**: JSON containing encrypted key, IV, auth tag, and content

### In-Memory Security

- Decrypted content is stored only in memory
- Files on disk are always encrypted (`.enc` extension)
- Memory is cleared when you lock notes or close VS Code
- No temporary files are created

### File Format

Encrypted files (`.enc`) are stored as JSON:

```json
{
  "version": 1,
  "encryptedKey": "base64...",
  "iv": "base64...",
  "authTag": "base64...",
  "content": "base64..."
}
```

## Development

### Building

```bash
npm install
npm run compile
```

### Watching for changes

```bash
npm run watch
```

### Testing

Press `F5` in VS Code to launch the Extension Development Host.

## License

MIT
