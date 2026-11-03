import { describe, expect, it } from 'vitest'
import { describeError, getProgress, setProgress } from '../failure'
import { formatLine } from '../logger'

describe('describeError', () => {
  it('keeps name, message, stack and code of an Error', () => {
    const err = Object.assign(new Error('boom'), { code: 'ENOENT' })
    const detail = describeError(err)
    expect(detail.name).toBe('Error')
    expect(detail.message).toBe('boom')
    expect(detail.code).toBe('ENOENT')
    expect(detail.stack).toContain('boom')
  })

  it('walks the cause chain', () => {
    const err = new Error('outer', {
      cause: new TypeError('inner'),
    })
    expect(describeError(err).cause).toMatchObject({ name: 'TypeError', message: 'inner' })
  })

  it('stringifies non-Error values', () => {
    expect(describeError('nope')).toEqual({ name: 'string', message: 'nope' })
  })
})

describe('progress', () => {
  it('returns a copy of the last progress set', () => {
    setProgress({ pdfPath: 'a.pdf', stage: 'render', page: 4 })
    const p = getProgress()
    expect(p).toEqual({ pdfPath: 'a.pdf', stage: 'render', page: 4 })
    p.page = 99
    expect(getProgress().page).toBe(4)
  })
})

describe('formatLine', () => {
  it('prints level, message and compact JSON meta', () => {
    expect(formatLine('info', 'hi', { a: 1 })).toBe('\x1B[32minfo\x1B[39m: hi {"a":1}')
  })

  it('omits meta when empty', () => {
    expect(formatLine('error', 'bad')).toBe('\x1B[31merror\x1B[39m: bad')
  })
})
