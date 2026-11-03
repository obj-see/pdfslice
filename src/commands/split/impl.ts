import type { AppContext } from '../../context'
import type { SplitFlags } from './command'
import process from 'node:process'
import { describeError, getProgress, watchExit } from '../../lib/failure'
import { createLogger } from '../../lib/logger'
import { splitAll } from '../../lib/split'

export async function splitImpl(
  this: AppContext,
  flags: SplitFlags,
  input: string,
): Promise<void> {
  const logger = createLogger({
    verbose: flags.verbose,
    quiet: flags.quiet,
    logFile: flags.logFile,
  })
  const done = watchExit('split')
  const startedAt = Date.now()

  try {
    const results = await splitAll({
      input,
      level: flags.level,
      flatten: flags.flatten,
      template: flags.template,
      force: flags.force,
      dryRun: flags.dryRun,
      logger,
    })

    logger.info(`Done. Processed ${results.length} PDF(s).`, {
      split: results.filter(r => !r.failed && !r.skipped).length,
      skipped: results.filter(r => !r.failed && r.skipped).length,
      failed: results.filter(r => r.failed).length,
      durationMs: Date.now() - startedAt,
    })

    // splitAll already logged which PDFs failed.
    if (results.some(r => r.failed))
      process.exitCode = 1
  }
  catch (err) {
    logger.error('Split failed', { input, ...getProgress(), error: describeError(err) })
    process.exitCode = 1
  }
  finally {
    done()
  }
}
