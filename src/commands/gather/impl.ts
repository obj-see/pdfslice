import type { AppContext } from '../../context'
import type { GatherFlags } from './command'
import process from 'node:process'
import { describeError, getProgress, watchExit } from '../../lib/failure'
import { gatherAll } from '../../lib/gather'
import { createLogger } from '../../lib/logger'

export async function gatherImpl(
  this: AppContext,
  flags: GatherFlags,
  input: string,
): Promise<void> {
  const logger = createLogger({
    verbose: flags.verbose,
    quiet: flags.quiet,
    logFile: flags.logFile,
  })
  const done = watchExit('gather')
  const startedAt = Date.now()

  try {
    const reports = await gatherAll({
      input,
      dryRun: flags.dryRun,
      backup: flags.backup,
      checkOnly: false,
      logger,
    })

    const withMissing = reports.filter(r => r.missingPages.length > 0)
    if (withMissing.length > 0) {
      logger.warn(`${withMissing.length} unit(s) have missing pages`)
    }
    logger.info(`Done. Processed ${reports.length} unit folder(s).`, {
      created: reports.filter(r => r.action === 'created').length,
      unchanged: reports.filter(r => r.action === 'skipped-unchanged').length,
      withMissingPages: reports.filter(r => r.missingPages.length > 0).length,
      failed: reports.filter(r => r.action === 'failed').length,
      durationMs: Date.now() - startedAt,
    })

    const failed = reports.filter(r => r.action === 'failed')
    if (failed.length > 0) {
      logger.error(`${failed.length} unit(s) failed`, {
        folders: failed.map(r => r.folder),
      })
      process.exitCode = 1
    }
  }
  catch (err) {
    logger.error('Gather failed', {
      input,
      ...getProgress(),
      error: describeError(err),
    })
    process.exitCode = 1
  }
  finally {
    done()
  }
}
