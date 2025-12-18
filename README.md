# Cursor Notepad

A simple notepad extension for VS Code/Cursor that provides a configurable directory tree view for managing notes.

## Features

- **Directory Tree View**: Shows your notes folder as a tree in the Explorer sidebar
- **Full CRUD Operations**: Create, rename, and delete files and folders
- **Auto-refresh**: Tree automatically updates when files change
- **Click to Open**: Single-click on any file to open it in the editor
- **Configurable Base Directory**: Set your notes folder via settings or command palette

## Usage

### Setting Up

1. Install the extension
2. Open Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
3. Run **"Notepad: Set Base Directory"**
4. Select your notes folder

Alternatively, add to your settings:

```json
{
  "notepad.baseDirectory": "/path/to/your/notes"
}
```

### Creating Notes

- Click the **New File** icon in the Notepad view title bar
- Or right-click a folder and select **New Note**

### Creating Folders

- Click the **New Folder** icon in the Notepad view title bar
- Or right-click a folder and select **New Folder**

### Renaming/Deleting

- Right-click any file or folder in the tree
- Select **Rename** or **Delete**

## Commands

| Command | Description |
|---------|-------------|
| `Notepad: Set Base Directory` | Opens folder picker to select notes directory |
| `notepad.createFile` | Create a new note file |
| `notepad.createFolder` | Create a new folder |
| `notepad.rename` | Rename selected item |
| `notepad.delete` | Delete selected item |
| `notepad.refresh` | Refresh the tree view |

## Settings

| Setting | Description | Default |
|---------|-------------|---------|
| `notepad.baseDirectory` | The base directory for your notes | `""` |

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

### Packaging

```bash
npm run package
```

## License

MIT

