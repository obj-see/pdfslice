import winston from 'winston'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export type LoggerOptions = {
  verbose?: boolean
  quiet?: boolean
  logFile?: string
}

// Same palette as winston's colorize(); spelled out so the exit guard
// (which cannot rely on winston's async pipeline) prints identical lines.
const COLOR_BY_LEVEL: Record<LogLevel, string> = {
  debug: '\x1B[34m',
  info: '\x1B[32m',
  warn: '\x1B[33m',
  error: '\x1B[31m',
}
const RESET = '\x1B[39m'

/**
 * One console line: `<level>: <message> <compact JSON meta>`.
 * pdfslice-py renders the exact same shape, so both CLIs log identically.
 */
export function formatLine(
  level: LogLevel,
  message: string,
  meta: Record<string, unknown> = {},
): string {
  const extra = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : ''
  return `${COLOR_BY_LEVEL[level]}${level}${RESET}: ${message}${extra}`
}

export function createLogger(opts: LoggerOptions = {}): winston.Logger {
  const level = opts.quiet ? 'error' : opts.verbose ? 'debug' : 'info'

  const transports: winston.transport[] = [
    new winston.transports.Console({
      // Errors go to stderr so they stay visible when stdout is piped.
      stderrLevels: ['error'],
      format: winston.format.printf(({ level: lvl, message, ...meta }) =>
        formatLine(lvl as LogLevel, String(message), meta)),
    }),
  ]

  if (opts.logFile !== undefined) {
    transports.push(
      new winston.transports.File({
        filename: opts.logFile,
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.json(),
        ),
      }),
    )
  }

  return winston.createLogger({ level, transports })
}
