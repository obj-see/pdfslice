import type { AppContext } from '../../context'
import type { SplitFlags } from './command'
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

  const results = await splitAll({
    input,
    level: flags.level,
    flatten: flags.flatten,
    template: flags.template,
    force: flags.force,
    dryRun: flags.dryRun,
    logger,
  })

  logger.info(`Done. Processed ${results.length} PDF(s).`)
}
