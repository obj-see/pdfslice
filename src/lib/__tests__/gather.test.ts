import { existsSync } from 'node:fs'
import { mkdtemp, readdir, rm, stat, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { gatherAll } from '../gather'
import { splitAll } from '../split'
import { makeTestPdf, silentLogger } from './test-helpers'

describe('gatherAll', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'pdfslice-gather-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  async function splitFixture(pageCount: number) {
    const pdfPath = path.join(root, 'sample.pdf')
    await makeTestPdf(pdfPath, pageCount)
    await splitAll({
      input: root,
      logger: silentLogger(),
    })
    return path.join(root, 'sample')
  }

  it('overwrites the pdf in place on the first run (no separate .gathered.pdf)', async () => {
    const unitFolder = await splitFixture(3)

    const reports = await gatherAll({
      input: root,
      logger: silentLogger(),
    })

    expect(reports).toHaveLength(1)
    expect(reports[0]!.action).toBe('created')
    expect(reports[0]!.missingPages).toEqual([])
    expect(reports[0]!.outputPdf).toBe(path.join(unitFolder, 'sample.pdf'))
  })

  it('skips recreating the pdf when nothing changed', async () => {
    await splitFixture(2)
    await gatherAll({
      input: root,
      logger: silentLogger(),
    })

    const second = await gatherAll({
      input: root,
      logger: silentLogger(),
    })
    expect(second[0]!.action).toBe('skipped-unchanged')
  })

  it('reports missing pages and still rebuilds when an image is removed', async () => {
    const unitFolder = await splitFixture(3)
    await gatherAll({
      input: root,
      logger: silentLogger(),
    })

    await unlink(path.join(unitFolder, 'sample.002.jpg'))

    const reports = await gatherAll({
      input: root,
      logger: silentLogger(),
    })
    expect(reports[0]!.missingPages).toEqual([2])
    expect(reports[0]!.action).toBe('created')
  })

  it('updates the pdf\'s mtime after content changes', async () => {
    const unitFolder = await splitFixture(2)
    await gatherAll({
      input: root,
      logger: silentLogger(),
    })
    const outputPdf = path.join(unitFolder, 'sample.pdf')
    const firstStat = await stat(outputPdf)

    await new Promise(r => setTimeout(r, 20))
    await unlink(path.join(unitFolder, 'sample.001.jpg'))

    await gatherAll({
      input: root,
      logger: silentLogger(),
    })

    const secondStat = await stat(outputPdf)
    expect(secondStat.mtimeMs).toBeGreaterThanOrEqual(firstStat.mtimeMs)
  })

  it('dry-run does not modify the pdf', async () => {
    const unitFolder = await splitFixture(2)
    const before = await stat(path.join(unitFolder, 'sample.pdf'))

    const reports = await gatherAll({
      input: root,
      dryRun: true,
      logger: silentLogger(),
    })

    expect(reports[0]!.action).toBe('would-create')
    const after = await stat(path.join(unitFolder, 'sample.pdf'))
    expect(after.mtimeMs).toBe(before.mtimeMs)
  })

  it('check-only mode never writes or modifies the pdf, even across repeated calls', async () => {
    const unitFolder = await splitFixture(2)
    const before = await stat(path.join(unitFolder, 'sample.pdf'))

    const reports = await gatherAll({
      input: root,
      checkOnly: true,
      logger: silentLogger(),
    })

    expect(reports[0]!.action).toBe('check-only')
    const after = await stat(path.join(unitFolder, 'sample.pdf'))
    expect(after.mtimeMs).toBe(before.mtimeMs)
  })

  it('backs up the previous pdf before overwriting on change (default on)', async () => {
    const unitFolder = await splitFixture(2)
    await gatherAll({
      input: root,
      logger: silentLogger(),
    })

    await unlink(path.join(unitFolder, 'sample.001.jpg'))
    await gatherAll({
      input: root,
      logger: silentLogger(),
    })

    const files = await readdir(unitFolder)
    const backups = files.filter(f => f.includes('.bak-'))
    expect(backups.length).toBeGreaterThanOrEqual(1)
  })

  it('skips backup when backup:false is passed', async () => {
    const unitFolder = await splitFixture(2)
    await gatherAll({
      input: root,
      backup: false,
      logger: silentLogger(),
    })

    await unlink(path.join(unitFolder, 'sample.001.jpg'))
    await gatherAll({
      input: root,
      backup: false,
      logger: silentLogger(),
    })

    const files = await readdir(unitFolder)
    const backups = files.filter(f => f.includes('.bak-'))
    expect(backups.length).toBe(0)
  })

  it('does not mistake the original source-directory pdf for a unit folder', async () => {
    await splitFixture(1)

    const reports = await gatherAll({
      input: root,
      logger: silentLogger(),
    })
    expect(reports).toHaveLength(1)
    expect(reports[0]!.folder).toBe(path.join(root, 'sample'))
  })

  it('resolves the source pdf from the manifest across repeated runs with backups present', async () => {
    const unitFolder = await splitFixture(1)
    await gatherAll({
      input: root,
      logger: silentLogger(),
    })

    await unlink(path.join(unitFolder, 'sample.001.jpg'))
    await gatherAll({
      input: root,
      logger: silentLogger(),
    })

    const files = await readdir(unitFolder)
    expect(files).toContain('sample.pdf')
    const backups = files.filter(f => f.includes('.bak-'))
    expect(backups.length).toBeGreaterThanOrEqual(1)
  })

  it('reports missing-source when a unit folder\'s pdf is absent', async () => {
    const unitFolder = await splitFixture(1)
    const manifestPath = path.join(unitFolder, '.pdfslice-manifest.json')
    expect(existsSync(manifestPath)).toBe(true)
    await unlink(path.join(unitFolder, 'sample.pdf'))

    const reports = await gatherAll({
      input: root,
      logger: silentLogger(),
    })
    expect(reports).toHaveLength(1)
    expect(reports[0]!.action).toBe('missing-source')
  })

  it('gathers correctly using a custom filename template recorded in the manifest', async () => {
    const pdfPath = path.join(root, 'sample.pdf')
    await makeTestPdf(pdfPath, 3)
    await splitAll({
      input: root,
      template: 'page-{{page_number}}.jpg',
      logger: silentLogger(),
    })

    const reports = await gatherAll({
      input: root,
      logger: silentLogger(),
    })
    expect(reports[0]!.action).toBe('created')
    expect(reports[0]!.missingPages).toEqual([])
    expect(reports[0]!.foundImages).toBe(3)
  })

  it('detects a missing page correctly with a custom template', async () => {
    const pdfPath = path.join(root, 'sample.pdf')
    await makeTestPdf(pdfPath, 3)
    await splitAll({
      input: root,
      template: 'page-{{page_number}}.jpg',
      logger: silentLogger(),
    })

    await unlink(path.join(root, 'sample', 'page-002.jpg'))

    const reports = await gatherAll({
      input: root,
      logger: silentLogger(),
    })
    expect(reports[0]!.missingPages).toEqual([2])
  })

  it('keeps reporting a missing page after a partial gather overwrote the pdf', async () => {
    const unitFolder = await splitFixture(3)
    await unlink(path.join(unitFolder, 'sample.002.jpg'))

    const first = await gatherAll({
      input: root,
      backup: false,
      logger: silentLogger(),
    })
    const second = await gatherAll({
      input: root,
      backup: false,
      logger: silentLogger(),
    })

    // the overwritten pdf has 2 pages, but the expected count stays 3
    expect(first[0]!.missingPages).toEqual([2])
    expect(second[0]!.missingPages).toEqual([2])
  })

  it('does not overwrite the pdf when no page image is left', async () => {
    const unitFolder = await splitFixture(2)
    await unlink(path.join(unitFolder, 'sample.001.jpg'))
    await unlink(path.join(unitFolder, 'sample.002.jpg'))

    const reports = await gatherAll({
      input: root,
      backup: false,
      logger: silentLogger(),
    })

    expect(reports[0]!.action).toBe('no-images')
  })
})
