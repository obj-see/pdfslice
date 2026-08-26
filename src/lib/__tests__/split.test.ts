import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readManifest } from '../manifest'
import { splitAll } from '../split'
import { makeTestPdf, silentLogger } from './test-helpers'

describe('splitAll', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'pdfslice-split-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('splits a pdf into per-page jpg images alongside it, keeping the original', async () => {
    const pdfPath = path.join(root, 'sample.pdf')
    await makeTestPdf(pdfPath, 3)

    const results = await splitAll({ input: root, logger: silentLogger() })

    expect(results).toHaveLength(1)
    const [result] = results
    expect(result!.pageCount).toBe(3)
    expect(result!.skipped).toBe(false)

    // original pdf at source path must still exist (never deleted)
    expect(existsSync(pdfPath)).toBe(true)

    const outputFolder = path.join(root, 'sample')
    expect(existsSync(outputFolder)).toBe(true)

    const files = (await readdir(outputFolder)).sort()
    expect(files).toEqual(
      [
        '.pdfslice-manifest.json',
        'sample.001.jpg',
        'sample.002.jpg',
        'sample.003.jpg',
        'sample.pdf',
      ].sort(),
    )
  }, 30000)

  it('writes a manifest recording page count and per-image hashes', async () => {
    const pdfPath = path.join(root, 'doc.pdf')
    await makeTestPdf(pdfPath, 2)

    await splitAll({ input: root, logger: silentLogger() })

    const manifest = await readManifest(path.join(root, 'doc'))
    expect(manifest).not.toBeNull()
    expect(manifest?.pageCount).toBe(2)
    expect(manifest?.images).toHaveLength(2)
    expect(manifest?.images[0]).toMatchObject({ file: 'doc.001.jpg', page: 1 })
    expect(manifest?.images[0]!.hash).toBeTruthy()
  }, 30000)

  it('does not descend into subfolders at default level 1', async () => {
    await makeTestPdf(path.join(root, 'top.pdf'), 1)
    const sub = path.join(root, 'sub')
    await mkdir(sub)
    await makeTestPdf(path.join(sub, 'nested.pdf'), 1)

    const results = await splitAll({ input: root, logger: silentLogger() })
    expect(results).toHaveLength(1)
    expect(results[0]!.pdf).toContain('top.pdf')
  }, 30000)

  it('descends into subfolders when level=2', async () => {
    await makeTestPdf(path.join(root, 'top.pdf'), 1)
    const sub = path.join(root, 'sub')
    await mkdir(sub)
    await makeTestPdf(path.join(sub, 'nested.pdf'), 1)

    const results = await splitAll({ input: root, level: 2, logger: silentLogger() })
    expect(results).toHaveLength(2)
  }, 30000)

  it('dry-run does not write any files', async () => {
    const pdfPath = path.join(root, 'sample.pdf')
    await makeTestPdf(pdfPath, 2)

    const results = await splitAll({
      input: root,
      dryRun: true,
      logger: silentLogger(),
    })

    expect(results).toHaveLength(1)
    expect(results[0]!.skipped).toBe(true)
    expect(existsSync(path.join(root, 'sample'))).toBe(false)
  }, 30000)

  it('flatten places the output folder at the input root instead of alongside the pdf', async () => {
    const sub = path.join(root, 'sub')
    await mkdir(sub)
    const pdfPath = path.join(sub, 'nested.pdf')
    await makeTestPdf(pdfPath, 1)

    await splitAll({ input: root, level: 2, flatten: true, logger: silentLogger() })

    expect(existsSync(path.join(root, 'nested'))).toBe(true)
    expect(existsSync(path.join(sub, 'nested'))).toBe(false)
  }, 30000)

  it('produces real jpeg-encoded bytes, not mislabeled png', async () => {
    const pdfPath = path.join(root, 'sample.pdf')
    await makeTestPdf(pdfPath, 1)
    await splitAll({ input: root, logger: silentLogger() })

    const imgPath = path.join(root, 'sample', 'sample.001.jpg')
    const buf = await (await import('node:fs/promises')).readFile(imgPath)
    // JPEG files start with FF D8 FF
    expect(buf[0]).toBe(0xFF)
    expect(buf[1]).toBe(0xD8)
    expect(buf[2]).toBe(0xFF)
  }, 30000)

  it('uses a custom filename template when provided', async () => {
    const pdfPath = path.join(root, 'sample.pdf')
    await makeTestPdf(pdfPath, 2)

    await splitAll({
      input: root,
      template: 'page-{{page_number}}.jpg',
      logger: silentLogger(),
    })

    const outputFolder = path.join(root, 'sample')
    const files = (await readdir(outputFolder)).sort()
    expect(files).toEqual(
      [
        '.pdfslice-manifest.json',
        'page-001.jpg',
        'page-002.jpg',
        'sample.pdf',
      ].sort(),
    )
  }, 30000)

  it('records the filename template used in the manifest', async () => {
    const pdfPath = path.join(root, 'sample.pdf')
    await makeTestPdf(pdfPath, 1)

    await splitAll({
      input: root,
      template: '{{page_number}}-{{filename}}.jpg',
      logger: silentLogger(),
    })

    const manifest = await readManifest(path.join(root, 'sample'))
    expect(manifest?.filenameTemplate).toBe('{{page_number}}-{{filename}}.jpg')
  }, 30000)

  it('skips re-splitting by default when the pdf was already split unchanged', async () => {
    const pdfPath = path.join(root, 'sample.pdf')
    await makeTestPdf(pdfPath, 2)

    const first = await splitAll({ input: root, logger: silentLogger() })
    expect(first[0]!.skipped).toBe(false)

    const second = await splitAll({ input: root, logger: silentLogger() })
    expect(second[0]!.skipped).toBe(true)
    expect(second[0]!.pageCount).toBe(2)
  }, 30000)

  it('does not rewrite image files when skipping an already-split pdf', async () => {
    const pdfPath = path.join(root, 'sample.pdf')
    await makeTestPdf(pdfPath, 2)
    await splitAll({ input: root, logger: silentLogger() })

    const imgPath = path.join(root, 'sample', 'sample.001.jpg')
    const before = await stat(imgPath)
    await new Promise(r => setTimeout(r, 20))

    await splitAll({ input: root, logger: silentLogger() })

    const after = await stat(imgPath)
    expect(after.mtimeMs).toBe(before.mtimeMs)
  }, 30000)

  it('re-splits when --force is passed even if unchanged', async () => {
    const pdfPath = path.join(root, 'sample.pdf')
    await makeTestPdf(pdfPath, 2)
    await splitAll({ input: root, logger: silentLogger() })

    const imgPath = path.join(root, 'sample', 'sample.001.jpg')
    const before = await stat(imgPath)
    await new Promise(r => setTimeout(r, 20))

    const results = await splitAll({ input: root, force: true, logger: silentLogger() })
    expect(results[0]!.skipped).toBe(false)

    const after = await stat(imgPath)
    expect(after.mtimeMs).toBeGreaterThan(before.mtimeMs)
  }, 30000)

  it('re-splits automatically when the pdf content changes, even without --force', async () => {
    const pdfPath = path.join(root, 'sample.pdf')
    await makeTestPdf(pdfPath, 2)
    await splitAll({ input: root, logger: silentLogger() })

    // overwrite with a pdf that has a different page count
    await makeTestPdf(pdfPath, 4)

    const results = await splitAll({ input: root, logger: silentLogger() })
    expect(results[0]!.skipped).toBe(false)
    expect(results[0]!.pageCount).toBe(4)
  }, 30000)

  it('clears stale page images when the re-split pdf has fewer pages', async () => {
    const pdfPath = path.join(root, 'sample.pdf')
    await makeTestPdf(pdfPath, 4)
    await splitAll({ input: root, logger: silentLogger() })

    await makeTestPdf(pdfPath, 2)
    await splitAll({ input: root, force: true, logger: silentLogger() })

    const files = (await readdir(path.join(root, 'sample'))).sort()
    const jpgs = files.filter(f => f.endsWith('.jpg'))
    expect(jpgs).toEqual(['sample.001.jpg', 'sample.002.jpg'])
  }, 30000)

  it('re-splits when the template changes, even without --force', async () => {
    const pdfPath = path.join(root, 'sample.pdf')
    await makeTestPdf(pdfPath, 1)
    await splitAll({ input: root, logger: silentLogger() })

    const results = await splitAll({
      input: root,
      template: 'page-{{page_number}}.jpg',
      logger: silentLogger(),
    })
    expect(results[0]!.skipped).toBe(false)

    const files = await readdir(path.join(root, 'sample'))
    expect(files).toContain('page-001.jpg')
  }, 30000)

  it('continues the batch when one file\'s worker process crashes', async () => {
    // A corrupt/invalid PDF makes the worker throw during PDFDocument.load
    // or pdf-to-img parsing — the worker catches it, reports failed, and
    // exits, but must NOT take down the parent or block later files.
    const badPdf = path.join(root, 'bad.pdf')
    await (await import('node:fs/promises')).writeFile(badPdf, 'not a real pdf')
    const goodPdf = path.join(root, 'good.pdf')
    await makeTestPdf(goodPdf, 2)

    const results = await splitAll({ input: root, logger: silentLogger() })

    expect(results).toHaveLength(2)
    const bad = results.find(r => r.pdf === badPdf)
    const good = results.find(r => r.pdf.includes('good'))

    expect(bad?.failed).toBe(true)
    expect(good?.failed).toBeFalsy()
    expect(good?.pageCount).toBe(2)
    expect(existsSync(path.join(root, 'good', 'good.001.jpg'))).toBe(true)
  }, 30000)
})
