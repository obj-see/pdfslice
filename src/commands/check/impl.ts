import type { AppContext } from '../../context'
import type { CheckFlags } from './command'
import process from 'node:process'
import { describeError, getProgress, watchExit } from '../../lib/failure'
import { gatherAll } from '../../lib/gather'
import { createLogger } from '../../lib/logger'

export async function checkImpl(
  this: AppContext,
  flags: CheckFlags,
  input: string,
): Promise<void> {
  const logger = createLogger({
    verbose: flags.verbose,
    quiet: flags.quiet,
    logFile: flags.logFile,
  })
  const done = watchExit('check')

  try {
    const reports = await gatherAll({
      input,
      checkOnly: true,
      logger,
    })

    const failed = reports.filter(r => r.action === 'failed')
    if (failed.length > 0) {
      logger.error(`${failed.length} unit(s) failed`, { folders: failed.map(r => r.folder) })
      process.exitCode = 1
    }

    const withMissing = reports.filter(r => r.missingPages.length > 0)
    if (withMissing.length > 0) {
      logger.warn(`${withMissing.length} unit(s) have missing pages`)
      process.exitCode = 1
    }
    else if (failed.length === 0) {
      logger.info(`All ${reports.length} unit(s) complete.`)
    }
  }
  catch (err) {
    logger.error('Check failed', { input, ...getProgress(), error: describeError(err) })
    process.exitCode = 1
  }
  finally {
    done()
  }
}
