import process from 'node:process'
import { describeError } from './describe-error'
import { formatLine } from './logger'

export { describeError } from './describe-error'
export type { ErrorDetail } from './describe-error'

export type Progress = {
  pdfPath?: string
  folder?: string
  stage?: string
  page?: number
}

let current: Progress = {}

/**
 * Remember what the process is doing right now. Read back when an error is
 * logged, and by the exit guard when the process dies without an error.
 */
export function setProgress(next: Progress): void {
  current = next
}

export function getProgress(): Progress {
  return { ...current }
}

/**
 * Node exits with code 0 when the event loop drains while a promise is
 * still pending (e.g. a PDF renderer that never answers). That looks like
 * success to callers. This guard turns it into a loud error with the last
 * known pdf / stage / page, and a non-zero exit code.
 *
 * Returns a `done()` to call once the command has finished normally.
 */
export function watchExit(command: string): () => void {
  let finished = false

  const onExit = (code: number): void => {
    if (finished)
      return
    process.stderr.write(`${formatLine('error', 'Process exited before command completed', {
      command,
      exitCode: code,
      ...getProgress(),
    })}\n`)
    process.exitCode = 1
  }

  const onRejection = (reason: unknown): void => {
    process.stderr.write(`${formatLine('error', 'Unhandled promise rejection', {
      command,
      ...getProgress(),
      error: describeError(reason),
    })}\n`)
    process.exitCode = 1
  }

  const onException = (err: Error): void => {
    process.stderr.write(`${formatLine('error', 'Uncaught exception', {
      command,
      ...getProgress(),
      error: describeError(err),
    })}\n`)
    process.exit(1)
  }

  process.on('exit', onExit)
  process.on('unhandledRejection', onRejection)
  process.on('uncaughtException', onException)

  return () => {
    finished = true
    process.removeListener('exit', onExit)
    process.removeListener('unhandledRejection', onRejection)
    process.removeListener('uncaughtException', onException)
  }
}
