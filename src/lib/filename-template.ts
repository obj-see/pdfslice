export const DEFAULT_TEMPLATE = '{{filename}}.{{page_number}}.jpg'

const PLACEHOLDER_PATTERN = /\{\{(filename|page_number)\}\}/g

function padPageNumber(page: number): string {
  return page < 1000
    ? String(page).padStart(3, '0')
    : String(page)
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export type FilenameTemplate = {
  render: (baseName: string, page: number) => string
  parsePage: (fileName: string) => number | null
}

export function compileTemplate(template: string): FilenameTemplate {
  const placeholders = template.match(PLACEHOLDER_PATTERN) ?? []
  const pageCount = placeholders.filter(p => p === '{{page_number}}').length

  if (pageCount !== 1) {
    throw new Error(
      `Template must contain exactly one {{page_number}} placeholder, found ${pageCount} in "${template}"`,
    )
  }

  const regexSource = template
    .split(PLACEHOLDER_PATTERN)
    .reduce<string>((acc, part, i) => {
      if (i % 2 === 0) {
        return acc + escapeRegExp(part)
      }
      if (part === 'page_number') {
        return `${acc}(\\d+)`
      }
      if (part === 'filename') {
        return `${acc}.+?`
      }
      return acc
    }, '')

  const regex = new RegExp(`^${regexSource}$`, 'i')

  return {
    render(baseName: string, page: number): string {
      return template
        .replace(/\{\{filename\}\}/g, baseName)
        .replace(/\{\{page_number\}\}/g, padPageNumber(page))
    },
    parsePage(fileName: string): number | null {
      const m = fileName.match(regex)
      if (!m)
        return null
      const raw = m[1]
      return raw !== undefined
        ? parseInt(raw, 10)
        : null
    },
  }
}
