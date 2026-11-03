import type { SplitOneOptions, SplitProgress, WorkerMessage } from './split-one-file'
import process from 'node:process'
import { describeError } from './describe-error'
import { splitOneFile } from './split-one-file'

function rssMb(): number {
  return Math.round(process.memoryUsage.rss() / 1024 / 1024)
}

/**
 * Resolves once the message is written to the IPC channel. Exiting right
 * after a bare process.send() can drop the message (it is queued, not
 * written), and the parent then sees an exit with no result — reported as
 * "Worker process crashed ... exited with code 0" even though the split
 * had finished. Big books produce a big result message, so it hit those most.
 */
async function send(message: WorkerMessage): Promise<void> {
  return new Promise((resolve) => {
    if (process.send === undefined) {
      resolve()
      return
    }
    process.send(message, undefined, undefined, () => resolve())
  })
}

/**
 * Standalone worker entry point, run via child_process.fork() — one
 * process per PDF, so a memory blowup on one book only kills that
 * process, never the parent orchestrating the whole batch.
 *
 * Protocol: parent sends a single SplitOneOptions message; this process
 * sends any number of { progress } messages, then either
 * { ok: true, result } or { ok: false, error }, and exits.
 */
// eslint-disable-next-line ts/no-misused-promises
process.once('message', async (opts: SplitOneOptions) => {
  let last: SplitProgress = { stage: 'start' }
  let reply: WorkerMessage
  try {
    const result = await splitOneFile(opts, (progress) => {
      last = progress
      void send({
        progress: {
          ...progress,
          rssMb: rssMb(),
        },
      })
    })
    reply = { ok: true, result }
  }
  catch (err) {
    reply = {
      ok: false,
      error: describeError(err),
      stage: last.stage,
      page: last.page,
    }
  }
  await send(reply)
  process.exit(0)
})
