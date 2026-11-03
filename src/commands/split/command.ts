import { buildCommand } from '@stricli/core'

export type SplitFlags = {
  level: number
  flatten: boolean
  template: string
  force: boolean
  dryRun: boolean
  verbose: boolean
  quiet: boolean
  logFile?: string
}

export const splitCommand = buildCommand({
  loader: async () => (await import('./impl')).splitImpl,
  parameters: {
    positional: {
      kind: 'tuple',
      parameters: [
        {
          brief: 'Folder to search for PDFs, or a single PDF file',
          parse: String,
          placeholder: 'input',
        },
      ],
    },
    flags: {
      level: {
        kind: 'parsed',
        parse: Number,
        brief: 'How many directory levels deep to search for PDFs',
        default: '1',
      },
      flatten: {
        kind: 'boolean',
        brief:
          'Pull every discovered PDF\'s output folder to the input root, instead of alongside each PDF',
        default: false,
      },
      template: {
        kind: 'parsed',
        parse: String,
        brief:
          'Page image filename template. Placeholders: {{filename}}, {{page_number}}. Must contain exactly one {{page_number}}.',
        default: '{{filename}}.{{page_number}}.jpg',
      },
      force: {
        kind: 'boolean',
        brief:
          'Re-split even if the output folder already matches this PDF (skipped by default)',
        default: false,
      },
      dryRun: {
        kind: 'boolean',
        brief: 'Preview actions without writing any files',
        default: false,
      },
      verbose: {
        kind: 'boolean',
        brief: 'Enable debug logging',
        default: false,
      },
      quiet: {
        kind: 'boolean',
        brief: 'Only log errors',
        default: false,
      },
      logFile: {
        kind: 'parsed',
        parse: String,
        brief: 'Path to also write logs as JSON',
        optional: true,
      },
    },
    aliases: { l: 'level', f: 'flatten' },
  },
  docs: {
    brief: 'Split PDF(s) into per-page JPG images alongside the source file',
  },
})
