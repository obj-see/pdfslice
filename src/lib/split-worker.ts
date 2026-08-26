import type { SplitOneOptions } from './split-one-file'
import process from 'node:process'
import { splitOneFile } from './split-one-file'

/**
 * Standalone worker entry point, run via child_process.fork() — one
 * process per PDF, so a memory blowup on one book only kills that
 * process, never the parent orchestrating the whole batch.
 *
 * Protocol: parent sends a single SplitOneOptions message; this process
 * replies with either { ok: true, result } or { ok: false, error } and
 * then exits.
 */
// eslint-disable-next-line ts/no-misused-promises
process.on('message', async (opts: SplitOneOptions) => {
  try {
    const result = await splitOneFile(opts)
    process.send?.({ ok: true, result })
  }
  catch (err) {
    process.send?.({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    })
  }
  finally {
    process.exit(0)
  }
})
