/**
 * Structured logging module for SecureNotes extension
 * 
 * Provides consistent logging with levels, timestamps, and context.
 * Sensitive data is automatically redacted in production.
 */

import * as vscode from 'vscode';

/**
 * Log levels for structured logging
 */
export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3
}

/**
 * Log entry structure
 */
export interface LogEntry {
    level: LogLevel;
    message: string;
    context?: string;
    data?: Record<string, unknown>;
    timestamp: Date;
    error?: Error;
}

/**
 * Logger configuration
 */
export interface LoggerConfig {
    minLevel: LogLevel;
    outputChannel?: vscode.OutputChannel;
    redactSensitive: boolean;
}

/**
 * Patterns for sensitive data that should be redacted
 */
const SENSITIVE_PATTERNS = [
    /passphrase/i,
    /password/i,
    /secret/i,
    /key/i,
    /token/i,
    /private/i
];

/**
 * Structured logger for the SecureNotes extension
 */
class Logger {
    private config: LoggerConfig;
    private outputChannel?: vscode.OutputChannel;

    constructor() {
        this.config = {
            minLevel: LogLevel.INFO,
            redactSensitive: true
        };
    }

    /**
     * Initialize the logger with an output channel
     */
    initialize(outputChannel: vscode.OutputChannel): void {
        this.outputChannel = outputChannel;
        this.config.outputChannel = outputChannel;
    }

    /**
     * Set the minimum log level
     */
    setLevel(level: LogLevel): void {
        this.config.minLevel = level;
    }

    /**
     * Enable/disable sensitive data redaction
     */
    setRedactSensitive(redact: boolean): void {
        this.config.redactSensitive = redact;
    }

    /**
     * Log a debug message
     */
    debug(message: string, context?: string, data?: Record<string, unknown>): void {
        this.log({ level: LogLevel.DEBUG, message, context, data, timestamp: new Date() });
    }

    /**
     * Log an info message
     */
    info(message: string, context?: string, data?: Record<string, unknown>): void {
        this.log({ level: LogLevel.INFO, message, context, data, timestamp: new Date() });
    }

    /**
     * Log a warning message
     */
    warn(message: string, context?: string, data?: Record<string, unknown>): void {
        this.log({ level: LogLevel.WARN, message, context, data, timestamp: new Date() });
    }

    /**
     * Log an error message
     */
    error(message: string, error?: Error, context?: string, data?: Record<string, unknown>): void {
        this.log({ level: LogLevel.ERROR, message, context, data, timestamp: new Date(), error });
    }

    /**
     * Internal logging method
     */
    private log(entry: LogEntry): void {
        if (entry.level < this.config.minLevel) {
            return;
        }

        const formattedMessage = this.formatLogEntry(entry);

        // Always log to console
        switch (entry.level) {
            case LogLevel.DEBUG:
                console.debug(formattedMessage);
                break;
            case LogLevel.INFO:
                console.log(formattedMessage);
                break;
            case LogLevel.WARN:
                console.warn(formattedMessage);
                break;
            case LogLevel.ERROR:
                console.error(formattedMessage);
                if (entry.error?.stack) {
                    console.error(entry.error.stack);
                }
                break;
        }

        // Log to output channel if available
        if (this.outputChannel) {
            this.outputChannel.appendLine(formattedMessage);
            if (entry.error?.stack && entry.level === LogLevel.ERROR) {
                this.outputChannel.appendLine(entry.error.stack);
            }
        }
    }

    /**
     * Format a log entry as a string
     */
    private formatLogEntry(entry: LogEntry): string {
        const levelStr = LogLevel[entry.level].padEnd(5);
        const timestamp = entry.timestamp.toISOString();
        const context = entry.context ? `[${entry.context}]` : '';
        
        let message = `${timestamp} ${levelStr} ${context} ${entry.message}`;

        if (entry.data) {
            const sanitizedData = this.config.redactSensitive 
                ? this.redactSensitiveData(entry.data) 
                : entry.data;
            message += ` ${JSON.stringify(sanitizedData)}`;
        }

        if (entry.error) {
            message += ` Error: ${entry.error.message}`;
        }

        return message;
    }

    /**
     * Redact sensitive data from log entries
     */
    private redactSensitiveData(data: Record<string, unknown>): Record<string, unknown> {
        const redacted: Record<string, unknown> = {};

        for (const [key, value] of Object.entries(data)) {
            const isSensitive = SENSITIVE_PATTERNS.some(pattern => pattern.test(key));
            
            if (isSensitive) {
                redacted[key] = '[REDACTED]';
            } else if (typeof value === 'object' && value !== null) {
                redacted[key] = this.redactSensitiveData(value as Record<string, unknown>);
            } else {
                redacted[key] = value;
            }
        }

        return redacted;
    }

    /**
     * Create a child logger with a specific context
     */
    child(context: string): ContextLogger {
        return new ContextLogger(this, context);
    }
}

/**
 * Logger with a fixed context
 */
class ContextLogger {
    constructor(
        private parent: Logger,
        private context: string
    ) {}

    debug(message: string, data?: Record<string, unknown>): void {
        this.parent.debug(message, this.context, data);
    }

    info(message: string, data?: Record<string, unknown>): void {
        this.parent.info(message, this.context, data);
    }

    warn(message: string, data?: Record<string, unknown>): void {
        this.parent.warn(message, this.context, data);
    }

    error(message: string, error?: Error, data?: Record<string, unknown>): void {
        this.parent.error(message, error, this.context, data);
    }
}

// Export singleton instance
export const logger = new Logger();

// Export child loggers for specific modules
export const encryptionLogger = logger.child('Encryption');
export const tempFileLogger = logger.child('TempFileManager');
export const treeLogger = logger.child('TreeProvider');
export const commandLogger = logger.child('Commands');

