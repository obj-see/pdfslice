import type { ErrorDetail } from './describe-error'
import type { Manifest, ManifestImageEntry } from './manifest'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readdir, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { pageImageName } from './discover'
import { hashFile } from './hash'
import { readManifest, writeManifest } from './manifest'
import { openPdfForRasterizing } from './pdf-rasterizer'

// Disable libvips' internal cache (default: 50MB memory + 100 files +
// 500MB disk). We process each page exactly once and never re-read it
// through sharp, so this cache buys nothing here and just holds memory
// for the life of the worker process — for a hundreds-of-pages book,
// that adds up. Safe to disable per-process since each PDF gets its own
// fresh worker anyway (no cross-file reuse to lose).
sharp.cache(false)
// libvips also runs a thread pool sized to CPU count by default; since
// pages are processed one at a time here (no parallelism to exploit),
// cap it to 1 to avoid idle worker threads holding their own memory.
sharp.concurrency(1)

const RENDER_SCALE = 2
const JPEG_QUALITY = 90

export type SplitOneOptions = {
  pdfPath: string
  input: string
  flatten: boolean
  template: string
  force: boolean
  dryRun: boolean
}

export type SplitOneResult = {
  pdf: string
  outputFolder: string
  pageCount: number
  images: string[]
  skipped: boolean
}

/** Where the worker currently is; the parent logs it and reads it back after a crash. */
export type SplitProgress = {
  stage: string
  page?: number
  pageCount?: number
  /** Set once a page image has been written. */
  fileName?: string
  /** Size of that page image. */
  bytes?: number
  /** Worker resident memory, to tell an out-of-memory kill from other crashes. */
  rssMb?: number
}

/** Messages the worker sends to the parent over IPC. */
export type WorkerMessage
  = | { progress: SplitProgress }
    | { ok: true, result: SplitOneResult }
    | { ok: false, error: ErrorDetail, stage?: string, page?: number }

function folderNameFor(pdfPath: string): string {
  return path.basename(pdfPath, path.extname(pdfPath))
}

/**
 * Split a single PDF into page images. Contains no logging calls (the
 * caller — either the in-process path or the worker-process wrapper —
 * handles logging) so this function has no dependency on winston and can
 * run standalone inside a forked child process.
 *
 * Image quality/resolution is unchanged from the original implementation:
 * scale: 2 rasterization, jpeg quality: 90.
 */
export async function splitOneFile(
  opts: SplitOneOptions,
  onProgress: (progress: SplitProgress) => void = () => {},
): Promise<SplitOneResult> {
  const { pdfPath, input, flatten, template, force, dryRun } = opts
  const baseName = folderNameFor(pdfPath)
  const parentDir = flatten
    ? input
    : path.dirname(pdfPath)
  const outputFolder = path.join(parentDir, baseName)
  const destPdfPath = path.join(outputFolder, path.basename(pdfPath))

  // Skip re-splitting when the output folder already reflects this exact
  // PDF (same content, same template) — avoids redundant rasterization
  // work on repeated runs. --force bypasses this check.
  if (!force && !dryRun && existsSync(destPdfPath)) {
    onProgress({ stage: 'check-existing' })
    const existingManifest = await readManifest(outputFolder)
    if (existingManifest && existingManifest.filenameTemplate === template) {
      const currentPdfHash = await hashFile(pdfPath)
      if (existingManifest.sourcePdfHash === currentPdfHash) {
        return {
          pdf: destPdfPath,
          outputFolder,
          pageCount: existingManifest.pageCount,
          images: existingManifest.images.map(i => path.join(outputFolder, i.file)),
          skipped: true,
        }
      }
    }
  }

  if (dryRun) {
    onProgress({ stage: 'open' })
    // Page count comes from the renderer, the same source the real run uses.
    const probe = await openPdfForRasterizing(pdfPath, { scale: RENDER_SCALE })
    const pageCount = probe.pageCount
    await probe.destroy()
    return {
      pdf: pdfPath,
      outputFolder,
      pageCount,
      images: [],
      skipped: true,
    }
  }

  onProgress({ stage: 'mkdir' })
  await mkdir(outputFolder, { recursive: true })

  // "Move" without deleting the original: copy into the new folder,
  // overwriting any stale copy from a previous split. The original PDF
  // at its source path is left untouched, per spec.
  onProgress({ stage: 'copy' })
  await copyFile(pdfPath, destPdfPath)

  // Clear any page images left over from a previous split of this folder
  // (e.g. the old PDF had more pages, or used a different template) so
  // stale images never linger alongside the freshly generated set.
  onProgress({ stage: 'cleanup' })
  const existingEntries = await readdir(outputFolder, { withFileTypes: true })
  for (const entry of existingEntries) {
    if (entry.isFile() && /\.jpe?g$/i.test(entry.name)) {
      await unlink(path.join(outputFolder, entry.name))
    }
  }

  const images: string[] = []
  const imageEntries: ManifestImageEntry[] = []

  // Direct pdfjs usage (via pdf-rasterizer.ts) instead of pdf-to-img: lets
  // us call page.cleanup() and destroy each page's canvas immediately
  // after encoding, so memory doesn't accumulate across a long book's
  // pages. See pdf-rasterizer.ts for why this matters.
  onProgress({ stage: 'open' })
  const rasterizer = await openPdfForRasterizing(destPdfPath, { scale: RENDER_SCALE })
  const pageCount = rasterizer.pageCount

  try {
    for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
      const fileName = pageImageName(baseName, pageNum, template)
      const imagePath = path.join(outputFolder, fileName)

      onProgress({ stage: 'render', page: pageNum, pageCount })
      const pngBuffer = await rasterizer.renderPage(pageNum)
      // Re-encode to real JPEG so the .jpg extension is accurate.
      // Quality/resolution unchanged: scale 2, jpeg quality 90. flatten() puts
      // transparent areas on white (JPEG has no alpha); the other encoder
      // options match what pdfslice-py passes to Pillow.
      onProgress({ stage: 'encode', page: pageNum, pageCount })
      const jpegBuffer = await sharp(pngBuffer)
        .flatten({ background: '#ffffff' })
        .jpeg({
          quality: JPEG_QUALITY,
          chromaSubsampling: '4:2:0',
          progressive: false,
          optimiseCoding: true,
        })
        .toBuffer()
      onProgress({ stage: 'write', page: pageNum, pageCount })
      await writeFile(imagePath, jpegBuffer)
      // Hash the buffer we already have in memory instead of re-reading
      // the file back from disk — same result, one less full-page read.
      const fileHash = createHash('sha256').update(jpegBuffer).digest('hex')
      images.push(imagePath)
      imageEntries.push({ file: fileName, page: pageNum, hash: fileHash })
      onProgress({
        stage: 'write',
        page: pageNum,
        pageCount,
        fileName,
        bytes: jpegBuffer.length,
      })
    }
  }
  finally {
    await rasterizer.destroy()
  }

  // The manifest is written last: a folder without one is an interrupted
  // split, which gather/check ignore.
  onProgress({ stage: 'manifest', pageCount })
  const sourcePdfHash = await hashFile(destPdfPath)
  const manifest: Manifest = {
    version: 1,
    sourcePdf: path.basename(destPdfPath),
    sourcePdfHash,
    pageCount,
    images: imageEntries,
    updatedAt: new Date().toISOString(),
    filenameTemplate: template,
  }
  await writeManifest(outputFolder, manifest)

  return {
    pdf: destPdfPath,
    outputFolder,
    pageCount,
    images,
    skipped: false,
  }
}
