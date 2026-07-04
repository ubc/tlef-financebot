import { ConsoleLogger, type LoggerInterface } from 'ubc-genai-toolkit-core';
import { env } from '../../config/env';

// The ubc-genai-toolkit modules log very chatty debug/info output through their
// ConsoleLogger (e.g. "OllamaProvider initialized ...", "Embedding generation
// completed ...") at every level. That floods startup and drowns out our own
// high-signal [server]/route logs. This logger keeps the toolkit wired up (so
// real warnings and errors still surface) but suppresses debug/info noise.
//
// Set GENAI_DEBUG=true to restore full verbosity when diagnosing the toolkit.
class QuietLogger implements LoggerInterface {
  constructor(private readonly prefix: string) {}

  debug(): void {
    // suppressed
  }

  info(): void {
    // suppressed
  }

  warn(message: string, metadata?: Record<string, unknown>): void {
    if (metadata) console.warn(`[${this.prefix}] ${message}`, metadata);
    else console.warn(`[${this.prefix}] ${message}`);
  }

  error(message: string, metadata?: Record<string, unknown>): void {
    if (metadata) console.error(`[${this.prefix}] ${message}`, metadata);
    else console.error(`[${this.prefix}] ${message}`);
  }
}

/**
 * Build the logger passed to a genai toolkit module. Quiet (warn/error only) by
 * default; the full ConsoleLogger (all levels) when GENAI_DEBUG=true.
 */
export function createGenaiLogger(prefix: string): LoggerInterface {
  return env.genaiDebug ? new ConsoleLogger(prefix) : new QuietLogger(prefix);
}
