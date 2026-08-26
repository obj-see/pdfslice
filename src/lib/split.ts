import type { Logger } from 'winston'
import type { SplitOneOptions, SplitOneResult } from './split-one-file'
import { fork } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { findPdfs } from './discover'
import { DEFAULT_TEMPLATE } from './filename-template'

export type SplitOptions = {
  /** Root folder or single PDF file to search. */
  input: string
  /** Directory recursion depth for discovery. Default 1 (no descend). */
  level?: number
  /** Pull every discovered PDF's output folder up to `input` root instead of alongside each PDF. */
  flatten?: boolean
  /** Filename template for page images. Default: "{{filename}}.{{page_number}}.jpg". */
  template?: string
  /** Re-split even if the output folder's manifest already matches this PDF. Default false. */
  force?: boolean
  dryRun?: boolean
  logger: Logger
}

export type SplitResult = {
  pdf: string
  outputFolder: string
  pageCount: number
  images: string[]
  skipped: boolean
  /** Set when this file's worker process crashed or errored; pageCount/images will be empty. */
  failed?: boolean
  errorMessage?: string
}

// Resolve the worker script. Bundlers (tsdown/esbuild/rollup) inline
// src/lib/*.ts into whichever entry file imports them, so there is no
// standalone "split-worker.js" sitting next to this module's original
// source path at runtime — import.meta.url-relative resolution breaks
// under bundling. Instead, resolve relative to the actual running
// entrypoint (process.argv[1], e.g. dist/cli.js), which the bundler
// guarantees is a real file, and require the worker to be its own
// explicit bundle entry (dist/split-worker.js) living alongside it.
// In dev (tsx, unbundled), fall back to the .ts source next to this file.
//
// Worker heap ceiling: 1024MB default. Pages are rasterized and written
// one at a time (no batching), so a single worker rarely needs more than
// a few hundred MB even for large-page-size books; 1GB leaves headroom
// without reserving multiple GB per file that's never used. Override with
// PDFSLICE_WORKER_MAX_OLD_SPACE_MB if a specific PDF genuinely needs more.
const WORKER_HEAP_MB = process.env.PDFSLICE_WORKER_MAX_OLD_SPACE_MB !== undefined
  ? Number(process.env.PDFSLICE_WORKER_MAX_OLD_SPACE_MB)
  : 1024

function resolveWorkerPath(): { path: string, execArgv: string[] } {
  const heapFlag = `--max-old-space-size=${WORKER_HEAP_MB}`
  const candidates: Array<{ path: string, execArgv: string[] }> = []

  // 1) Sibling of the actual running entrypoint (process.argv[1]) — correct
  //    for flat single-directory bundles (tsdown/esbuild/rollup), where
  //    split-worker is declared as its own bundle entry alongside cli.js.
  if (process.argv[1] !== undefined) {
    const entrypointDir = path.dirname(path.resolve(process.argv[1]))
    candidates.push(
      { path: path.join(entrypointDir, 'split-worker'), execArgv: [heapFlag] },
      { path: path.join(entrypointDir, 'split-worker.cjs'), execArgv: [heapFlag] },
    )
  }

  // 2) Sibling of *this compiled module's own location* — correct for
  //    per-file compilers (tsc) that preserve the src/ directory structure
  //    into dist/ (e.g. dist/lib/split.js next to dist/lib/split-worker.js),
  //    where the entrypoint (dist/bin/cli.js) lives in a different folder.
  const thisFileDir = path.dirname(fileURLToPath(import.meta.url))
  candidates.push(
    { path: path.join(thisFileDir, 'split-worker'), execArgv: [heapFlag] },
    { path: path.join(thisFileDir, 'split-worker.cjs'), execArgv: [heapFlag] },
  )

  // 3) Dev fallback: running from source via tsx (no bundler/compiler
  //    involved) — the worker's .ts source is a genuine sibling.
  candidates.push({
    path: path.join(thisFileDir, 'split-worker.ts'),
    execArgv: ['--import', 'tsx', heapFlag],
  })

  const found = candidates.find(c => existsSync(c.path))
  if (found)
    return found

  throw new Error(
    `Could not locate split-worker script. Looked for:\n${
      candidates.map(c => `  ${c.path}`).join('\n')
    }\nIf you're using a bundler, make sure "src/lib/split-worker.ts" is its own entry point `
    + `so it emits a standalone file (either next to your CLI entrypoint, or next to dist/lib/split.js).`,
  )
}

const { path: WORKER_PATH, execArgv: WORKER_EXEC_ARGV } = resolveWorkerPath()

export async function splitAll(opts: SplitOptions): Promise<SplitResult[]> {
  const {
    input,
    level = 1,
    flatten = false,
    template = DEFAULT_TEMPLATE,
    force = false,
    dryRun = false,
    logger,
  } = opts
  const pdfs = await findPdfs(input, level)
  logger.info(`Found ${pdfs.length} PDF file(s) under ${input}`, { level })

  const results: SplitResult[] = []
  for (const [index, pdfPath] of pdfs.entries()) {
    logger.info(`Processing PDF ${index + 1}/${pdfs.length}`, { pdfPath })
    const result = await splitOneInWorker(
      { pdfPath, input, flatten, template, force, dryRun },
      logger,
    )
    results.push(result)
  }

  const failedCount = results.filter(r => r.failed).length
  if (failedCount > 0) {
    logger.warn(`${failedCount} of ${pdfs.length} PDF(s) failed to split`, {
      failed: results.filter(r => r.failed).map(r => r.pdf),
    })
  }

  return results
}

/**
 * Runs splitOneFile for a single PDF in its own child process, so that a
 * memory blowup (large/complex PDF) or any other crash in that process
 * only affects this one file — the batch continues with the next PDF
 * instead of the whole run dying.
 */
async function splitOneInWorker(
  fileOpts: SplitOneOptions,
  logger: Logger,
): Promise<SplitResult> {
  return new Promise((resolve) => {
    const child = fork(WORKER_PATH, [], {
      // Inherit stdio for visibility, but communicate the actual result
      // over IPC (process.send/on('message')) rather than parsing stdout.
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
      execArgv: WORKER_EXEC_ARGV,
    })

    let settled = false
    const finish = (result: SplitResult) => {
      if (settled)
        return
      settled = true
      resolve(result)
    }

    child.on('message', (msg: { ok: true, result: SplitOneResult } | { ok: false, error: string }) => {
      if (msg.ok) {
        finish({ ...msg.result })
      }
      else {
        logger.error(`Failed to split PDF`, { pdfPath: fileOpts.pdfPath, error: msg.error })
        finish({
          pdf: fileOpts.pdfPath,
          outputFolder: '',
          pageCount: 0,
          images: [],
          skipped: false,
          failed: true,
          errorMessage: msg.error,
        })
      }
    })

    child.on('error', (err) => {
      logger.error(`Worker process error`, { pdfPath: fileOpts.pdfPath, error: err.message })
      finish({
        pdf: fileOpts.pdfPath,
        outputFolder: '',
        pageCount: 0,
        images: [],
        skipped: false,
        failed: true,
        errorMessage: err.message,
      })
    })

    child.on('exit', (code, signal) => {
      // A non-zero/signal exit without ever sending a result message means
      // the process crashed outright (e.g. OOM kill) — treat as failure
      // for this file and move on rather than losing the whole batch.
      if (!settled) {
        const reason = signal
          ? `killed by signal ${signal} (likely out of memory)`
          : `exited with code ${code}`
        logger.error(`Worker process crashed`, { pdfPath: fileOpts.pdfPath, reason })
        finish({
          pdf: fileOpts.pdfPath,
          outputFolder: '',
          pageCount: 0,
          images: [],
          skipped: false,
          failed: true,
          errorMessage: reason,
        })
      }
    })

    child.send(fileOpts)
  })
}
