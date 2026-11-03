import type { Manifest } from '../manifest'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  MANIFEST_FILENAME,
  manifestPathFor,
  readManifest,
  writeManifest,
} from '../manifest'

describe('manifest', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'pdfslice-manifest-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('manifestPathFor joins the folder and manifest filename', () => {
    expect(manifestPathFor(dir)).toBe(path.join(dir, MANIFEST_FILENAME))
  })

  it('readManifest returns null when no manifest exists', async () => {
    expect(await readManifest(dir)).toBeNull()
  })

  it('writeManifest then readManifest round-trips the same data', async () => {
    const manifest: Manifest = {
      version: 1,
      sourcePdf: 'sample.pdf',
      sourcePdfHash: 'deadbeef',
      pageCount: 2,
      images: [
        { file: 'sample.001.jpg', page: 1, hash: 'hash1' },
        { file: 'sample.002.jpg', page: 2, hash: 'hash2' },
      ],
      updatedAt: '2026-01-01T00:00:00.000Z',
      filenameTemplate: '{{filename}}.{{page_number}}.jpg',
    }

    await writeManifest(dir, manifest)
    expect(existsSync(manifestPathFor(dir))).toBe(true)

    const loaded = await readManifest(dir)
    expect(loaded).toEqual(manifest)
  })

  it('writeManifest overwrites a previous manifest at the same path', async () => {
    const first: Manifest = {
      version: 1,
      sourcePdf: 'sample.pdf',
      sourcePdfHash: 'hash-old',
      pageCount: 1,
      images: [
        { file: 'sample.001.jpg', page: 1, hash: 'h1' },
      ],
      updatedAt: '2026-01-01T00:00:00.000Z',
      filenameTemplate: '{{filename}}.{{page_number}}.jpg',
    }
    const second: Manifest = {
      ...first,
      sourcePdfHash: 'hash-new',
      pageCount: 2,
      images: [
        { file: 'sample.001.jpg', page: 1, hash: 'h1' },
        { file: 'sample.002.jpg', page: 2, hash: 'h2' },
      ],
    }

    await writeManifest(dir, first)
    await writeManifest(dir, second)

    const loaded = await readManifest(dir)
    expect(loaded).toEqual(second)
  })
})
