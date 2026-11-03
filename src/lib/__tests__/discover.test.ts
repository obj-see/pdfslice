import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  findImagesDeep,
  findPdfs,
  pageImageName,
  parsePageFromImageName,
} from '../discover'

describe('pageImageName', () => {
  it('pads page numbers under 1000 to 3 digits', () => {
    expect(pageImageName('sample', 1)).toBe('sample.001.jpg')
    expect(pageImageName('sample', 42)).toBe('sample.042.jpg')
    expect(pageImageName('sample', 999)).toBe('sample.999.jpg')
  })

  it('does not pad page numbers 1000 and above', () => {
    expect(pageImageName('sample', 1000)).toBe('sample.1000.jpg')
    expect(pageImageName('sample', 2026)).toBe('sample.2026.jpg')
  })
})

describe('parsePageFromImageName', () => {
  it('extracts the page number from a well-formed name', () => {
    expect(parsePageFromImageName('sample.001.jpg')).toBe(1)
    expect(parsePageFromImageName('sample.2026.jpg')).toBe(2026)
  })

  it('returns null for names without a page number', () => {
    expect(parsePageFromImageName('sample.jpg')).toBeNull()
    expect(parsePageFromImageName('readme.txt')).toBeNull()
  })
})

describe('findPdfs', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'pdfslice-discover-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('returns the file itself when input is a single pdf', async () => {
    const file = path.join(root, 'a.pdf')
    await writeFile(file, 'fake')
    const found = await findPdfs(file)
    expect(found).toEqual([file])
  })

  it('returns empty array when input is a single non-pdf file', async () => {
    const file = path.join(root, 'a.txt')
    await writeFile(file, 'fake')
    const found = await findPdfs(file)
    expect(found).toEqual([])
  })

  it('finds pdfs directly in root at level 1 (default)', async () => {
    await writeFile(path.join(root, 'one.pdf'), 'x')
    await writeFile(path.join(root, 'two.pdf'), 'x')
    await writeFile(path.join(root, 'note.txt'), 'x')
    const found = await findPdfs(root)
    expect(found.sort()).toEqual(
      [
        path.join(root, 'one.pdf'),
        path.join(root, 'two.pdf'),
      ].sort(),
    )
  })

  it('does not descend into subfolders at level 1', async () => {
    await writeFile(path.join(root, 'top.pdf'), 'x')
    const sub = path.join(root, 'sub')
    await mkdir(sub)
    await writeFile(path.join(sub, 'nested.pdf'), 'x')
    const found = await findPdfs(root, 1)
    expect(found).toEqual([
      path.join(root, 'top.pdf'),
    ])
  })

  it('descends one level with level=2', async () => {
    await writeFile(path.join(root, 'top.pdf'), 'x')
    const sub = path.join(root, 'sub')
    await mkdir(sub)
    await writeFile(path.join(sub, 'nested.pdf'), 'x')
    const found = await findPdfs(root, 2)
    expect(found.sort()).toEqual(
      [
        path.join(root, 'top.pdf'),
        path.join(sub, 'nested.pdf'),
      ].sort(),
    )
  })

  it('does not find a pdf two levels deep at level 2', async () => {
    const sub1 = path.join(root, 'sub1')
    const sub2 = path.join(sub1, 'sub2')
    await mkdir(sub2, { recursive: true })
    await writeFile(path.join(sub2, 'deep.pdf'), 'x')
    const found = await findPdfs(root, 2)
    expect(found).toEqual([])
  })
})

describe('findImagesDeep', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'pdfslice-images-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('finds jpg/jpeg files at any depth', async () => {
    await writeFile(path.join(root, 'a.jpg'), 'x')
    const sub = path.join(root, 'nested', 'deeper')
    await mkdir(sub, { recursive: true })
    await writeFile(path.join(sub, 'b.jpeg'), 'x')
    await writeFile(path.join(sub, 'c.png'), 'x') // should be ignored
    const found = await findImagesDeep(root)
    expect(found.sort()).toEqual(
      [
        path.join(root, 'a.jpg'),
        path.join(sub, 'b.jpeg'),
      ].sort(),
    )
  })

  it('returns empty array when no images present', async () => {
    await writeFile(path.join(root, 'doc.pdf'), 'x')
    const found = await findImagesDeep(root)
    expect(found).toEqual([])
  })
})
