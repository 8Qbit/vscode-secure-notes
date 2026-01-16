/**
 * Unit tests for AutoSaveManager
 */

import * as path from 'path';
import { createTestDir, cleanupTestDir } from './setup';
import { AutoSaveManager } from '../autoSaveManager';
import { mockConfigValues, workspaceEventEmitters, workspace, EventEmitter } from '../__mocks__/vscode';

// Helper to reset event emitters between tests
function resetEventEmitters() {
    workspaceEventEmitters.onDidChangeConfiguration = new EventEmitter();
    workspaceEventEmitters.onDidSaveTextDocument = new EventEmitter();
    workspaceEventEmitters.onDidCloseTextDocument = new EventEmitter();
    workspaceEventEmitters.onDidChangeTextDocument = new EventEmitter();
}

// Mock document factory
function createMockDocument(fsPath: string, options: Partial<{
    isDirty: boolean;
    isUntitled: boolean;
    isClosed: boolean;
}> = {}) {
    const saved = { value: false };
    return {
        uri: { fsPath },
        isDirty: options.isDirty ?? true,
        isUntitled: options.isUntitled ?? false,
        isClosed: options.isClosed ?? false,
        save: jest.fn().mockImplementation(() => {
            saved.value = true;
            return Promise.resolve(true);
        }),
        _saved: saved,
    };
}

describe('AutoSaveManager', () => {
    let testDir: string;
    let autoSaveManager: AutoSaveManager;

    beforeEach(() => {
        testDir = createTestDir('autosave');
        
        // Reset event emitters to avoid cross-test pollution
        resetEventEmitters();
        
        // Reset mock config values
        mockConfigValues['enabled'] = true;
        mockConfigValues['delaySeconds'] = 1; // Use 1 second for faster tests
        
        // Clear workspace.textDocuments
        workspace.textDocuments = [];
        
        // Use fake timers for precise control
        jest.useFakeTimers();
    });

    afterEach(() => {
        // Dispose manager if it exists
        if (autoSaveManager) {
            autoSaveManager.dispose();
        }
        
        // Restore real timers
        jest.useRealTimers();
        
        // Clean up test directory
        cleanupTestDir(testDir);
        
        // Reset mock config
        Object.keys(mockConfigValues).forEach(key => delete mockConfigValues[key]);
    });

    describe('initialization', () => {
        it('should initialize with config values', () => {
            mockConfigValues['enabled'] = true;
            mockConfigValues['delaySeconds'] = 10;
            
            autoSaveManager = new AutoSaveManager(
                () => testDir,
                () => []
            );
            
            expect(autoSaveManager.isEnabled()).toBe(true);
            expect(autoSaveManager.getDelaySeconds()).toBe(10);
        });

        it('should use default values when config is not set', () => {
            delete mockConfigValues['enabled'];
            delete mockConfigValues['delaySeconds'];
            
            autoSaveManager = new AutoSaveManager(
                () => testDir,
                () => []
            );
            
            expect(autoSaveManager.isEnabled()).toBe(true);
            expect(autoSaveManager.getDelaySeconds()).toBe(5);
        });

        it('should respect disabled config', () => {
            mockConfigValues['enabled'] = false;
            
            autoSaveManager = new AutoSaveManager(
                () => testDir,
                () => []
            );
            
            expect(autoSaveManager.isEnabled()).toBe(false);
        });
    });

    describe('document change handling', () => {
        it('should schedule save after document change in notes directory', () => {
            autoSaveManager = new AutoSaveManager(
                () => testDir,
                () => []
            );
            
            const docPath = path.join(testDir, 'test.md');
            const mockDoc = createMockDocument(docPath);
            
            // Simulate document change
            workspaceEventEmitters.onDidChangeTextDocument.fire({ document: mockDoc });
            
            // Save should not happen immediately
            expect(mockDoc.save).not.toHaveBeenCalled();
            
            // Advance timer by delay
            jest.advanceTimersByTime(1000);
            
            // Now save should have been called
            expect(mockDoc.save).toHaveBeenCalledTimes(1);
        });

        it('should not save documents outside notes directory', () => {
            autoSaveManager = new AutoSaveManager(
                () => testDir,
                () => []
            );
            
            const docPath = '/some/other/path/test.md';
            const mockDoc = createMockDocument(docPath);
            
            // Simulate document change
            workspaceEventEmitters.onDidChangeTextDocument.fire({ document: mockDoc });
            
            // Advance timer
            jest.advanceTimersByTime(1000);
            
            // Save should not have been called
            expect(mockDoc.save).not.toHaveBeenCalled();
        });

        it('should save temp files for encrypted notes', () => {
            const tempPath = '/dev/shm/secure-notes/encrypted-temp.md';
            
            autoSaveManager = new AutoSaveManager(
                () => testDir,
                () => [tempPath]
            );
            
            const mockDoc = createMockDocument(tempPath);
            
            // Simulate document change
            workspaceEventEmitters.onDidChangeTextDocument.fire({ document: mockDoc });
            
            // Advance timer
            jest.advanceTimersByTime(1000);
            
            // Save should have been called for temp file
            expect(mockDoc.save).toHaveBeenCalledTimes(1);
        });

        it('should reset timer on subsequent changes', () => {
            autoSaveManager = new AutoSaveManager(
                () => testDir,
                () => []
            );
            
            const docPath = path.join(testDir, 'test.md');
            const mockDoc = createMockDocument(docPath);
            
            // First change
            workspaceEventEmitters.onDidChangeTextDocument.fire({ document: mockDoc });
            
            // Advance halfway
            jest.advanceTimersByTime(500);
            expect(mockDoc.save).not.toHaveBeenCalled();
            
            // Second change - resets timer
            workspaceEventEmitters.onDidChangeTextDocument.fire({ document: mockDoc });
            
            // Advance another 500ms (total 1000ms from first change, but only 500ms from second)
            jest.advanceTimersByTime(500);
            expect(mockDoc.save).not.toHaveBeenCalled();
            
            // Advance remaining time
            jest.advanceTimersByTime(500);
            expect(mockDoc.save).toHaveBeenCalledTimes(1);
        });

        it('should not save untitled documents', () => {
            autoSaveManager = new AutoSaveManager(
                () => testDir,
                () => []
            );
            
            const docPath = path.join(testDir, 'untitled.md');
            const mockDoc = createMockDocument(docPath, { isUntitled: true });
            
            // Simulate document change
            workspaceEventEmitters.onDidChangeTextDocument.fire({ document: mockDoc });
            
            // Advance timer
            jest.advanceTimersByTime(1000);
            
            // Save should not have been called
            expect(mockDoc.save).not.toHaveBeenCalled();
        });

        it('should not save when disabled', () => {
            mockConfigValues['enabled'] = false;
            
            autoSaveManager = new AutoSaveManager(
                () => testDir,
                () => []
            );
            
            const docPath = path.join(testDir, 'test.md');
            const mockDoc = createMockDocument(docPath);
            
            // Simulate document change
            workspaceEventEmitters.onDidChangeTextDocument.fire({ document: mockDoc });
            
            // Advance timer
            jest.advanceTimersByTime(1000);
            
            // Save should not have been called
            expect(mockDoc.save).not.toHaveBeenCalled();
        });
    });

    describe('pending save cancellation', () => {
        it('should cancel pending save when document is closed', () => {
            autoSaveManager = new AutoSaveManager(
                () => testDir,
                () => []
            );
            
            const docPath = path.join(testDir, 'test.md');
            const mockDoc = createMockDocument(docPath);
            
            // Simulate document change
            workspaceEventEmitters.onDidChangeTextDocument.fire({ document: mockDoc });
            
            // Close document before save triggers
            jest.advanceTimersByTime(500);
            workspaceEventEmitters.onDidCloseTextDocument.fire({ uri: { fsPath: docPath } });
            
            // Advance past the delay
            jest.advanceTimersByTime(1000);
            
            // Save should not have been called
            expect(mockDoc.save).not.toHaveBeenCalled();
        });

        it('should cancel pending save when document is saved manually', () => {
            autoSaveManager = new AutoSaveManager(
                () => testDir,
                () => []
            );
            
            const docPath = path.join(testDir, 'test.md');
            const mockDoc = createMockDocument(docPath);
            
            // Simulate document change
            workspaceEventEmitters.onDidChangeTextDocument.fire({ document: mockDoc });
            
            // Manual save before autosave triggers
            jest.advanceTimersByTime(500);
            workspaceEventEmitters.onDidSaveTextDocument.fire({ uri: { fsPath: docPath }, isDirty: false });
            
            // Advance past the delay
            jest.advanceTimersByTime(1000);
            
            // Autosave should not have triggered (only manual save would have called it)
            expect(mockDoc.save).not.toHaveBeenCalled();
        });
    });

    describe('configuration changes', () => {
        it('should update delay when config changes', () => {
            autoSaveManager = new AutoSaveManager(
                () => testDir,
                () => []
            );
            
            expect(autoSaveManager.getDelaySeconds()).toBe(1);
            
            // Update config
            mockConfigValues['delaySeconds'] = 10;
            
            // Fire config change event
            workspaceEventEmitters.onDidChangeConfiguration.fire({
                affectsConfiguration: (section: string) => section === 'secureNotes.autosave'
            });
            
            expect(autoSaveManager.getDelaySeconds()).toBe(10);
        });

        it('should cancel pending saves when disabled via config change', () => {
            autoSaveManager = new AutoSaveManager(
                () => testDir,
                () => []
            );
            
            const docPath = path.join(testDir, 'test.md');
            const mockDoc = createMockDocument(docPath);
            
            // Simulate document change
            workspaceEventEmitters.onDidChangeTextDocument.fire({ document: mockDoc });
            
            // Disable via config change
            jest.advanceTimersByTime(500);
            mockConfigValues['enabled'] = false;
            workspaceEventEmitters.onDidChangeConfiguration.fire({
                affectsConfiguration: (section: string) => section === 'secureNotes.autosave'
            });
            
            // Advance past the delay
            jest.advanceTimersByTime(1000);
            
            // Save should not have been called
            expect(mockDoc.save).not.toHaveBeenCalled();
        });
    });

    describe('disposal', () => {
        it('should cancel all pending saves on dispose', () => {
            autoSaveManager = new AutoSaveManager(
                () => testDir,
                () => []
            );
            
            const docPath = path.join(testDir, 'test.md');
            const mockDoc = createMockDocument(docPath);
            
            // Simulate document change
            workspaceEventEmitters.onDidChangeTextDocument.fire({ document: mockDoc });
            
            // Dispose before save triggers
            jest.advanceTimersByTime(500);
            autoSaveManager.dispose();
            
            // Advance past the delay
            jest.advanceTimersByTime(1000);
            
            // Save should not have been called
            expect(mockDoc.save).not.toHaveBeenCalled();
        });
    });

    describe('edge cases', () => {
        it('should handle missing base directory', () => {
            autoSaveManager = new AutoSaveManager(
                () => undefined,
                () => []
            );
            
            const docPath = '/any/path/test.md';
            const mockDoc = createMockDocument(docPath);
            
            // Simulate document change
            workspaceEventEmitters.onDidChangeTextDocument.fire({ document: mockDoc });
            
            // Advance timer
            jest.advanceTimersByTime(1000);
            
            // Save should not have been called (no base directory)
            expect(mockDoc.save).not.toHaveBeenCalled();
        });

        it('should not save non-dirty documents', () => {
            autoSaveManager = new AutoSaveManager(
                () => testDir,
                () => []
            );
            
            const docPath = path.join(testDir, 'test.md');
            const mockDoc = createMockDocument(docPath, { isDirty: false });
            
            // Simulate document change (even though not dirty)
            workspaceEventEmitters.onDidChangeTextDocument.fire({ document: mockDoc });
            
            // Advance timer
            jest.advanceTimersByTime(1000);
            
            // Save should not have been called
            expect(mockDoc.save).not.toHaveBeenCalled();
        });

        it('should handle multiple documents independently', () => {
            autoSaveManager = new AutoSaveManager(
                () => testDir,
                () => []
            );
            
            const doc1Path = path.join(testDir, 'doc1.md');
            const doc2Path = path.join(testDir, 'doc2.md');
            const mockDoc1 = createMockDocument(doc1Path);
            const mockDoc2 = createMockDocument(doc2Path);
            
            // Change doc1
            workspaceEventEmitters.onDidChangeTextDocument.fire({ document: mockDoc1 });
            
            // After 500ms, change doc2
            jest.advanceTimersByTime(500);
            workspaceEventEmitters.onDidChangeTextDocument.fire({ document: mockDoc2 });
            
            // After another 500ms (1000ms total from doc1, 500ms from doc2)
            jest.advanceTimersByTime(500);
            expect(mockDoc1.save).toHaveBeenCalledTimes(1);
            expect(mockDoc2.save).not.toHaveBeenCalled();
            
            // After another 500ms (1000ms from doc2)
            jest.advanceTimersByTime(500);
            expect(mockDoc2.save).toHaveBeenCalledTimes(1);
        });
    });
});
