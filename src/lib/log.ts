// Set LOG_LEVEL=debug|info|warn|error in the environment to change verbosity (default: debug).
const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
type Level = keyof typeof LEVELS;

function minLevel(): number {
  const configured = process.env.LOG_LEVEL?.toLowerCase();
  return configured && configured in LEVELS ? LEVELS[configured as Level] : LEVELS.debug;
}

// Flattens whitespace and truncates so message/email content never floods the terminal.
export function preview(text: string, max = 120): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}… (${text.length} chars)` : flat;
}

export function since(startMs: number): string {
  return `${Date.now() - startMs}ms`;
}

export function createLogger(scope: string) {
  const emit = (level: Level, message: string, data: unknown[]) => {
    if (LEVELS[level] < minLevel()) return;
    const time = new Date().toISOString().slice(11, 23);
    const line = `${time} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}`;
    const write = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    write(line, ...data);
  };
  return {
    debug: (message: string, ...data: unknown[]) => emit('debug', message, data),
    info: (message: string, ...data: unknown[]) => emit('info', message, data),
    warn: (message: string, ...data: unknown[]) => emit('warn', message, data),
    error: (message: string, ...data: unknown[]) => emit('error', message, data),
  };
}
