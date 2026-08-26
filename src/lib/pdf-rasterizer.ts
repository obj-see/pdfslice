import type { Canvas } from '@napi-rs/canvas'
import type Buffer from 'node:buffer'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { createCanvas } from '@napi-rs/canvas'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'

/**
 * Direct pdfjs-dist usage instead of `pdf-to-img`, because pdf-to-img's
 * getPage() never calls PDFPageProxy#cleanup() or releases the canvas
 * after rendering. For large scanned books (hundreds of pages, each with
 * an embedded high-resolution image), that means every page's decoded
 * image data, fonts, and operator list stay resident in memory for the
 * entire document — accumulating across the whole book instead of being
 * released per page. That accumulation, not any single-page allocation,
 * is what drives RSS up over a long book and eventually OOMs the worker.
 *
 * This module calls page.cleanup() after each page is rendered and
 * encoded, so peak memory stays bounded by roughly one page's worth of
 * raster data rather than growing with page count.
 *
 * Uses @napi-rs/canvas, not node-canvas: pdfjs-dist v6's own built-in
 * Node canvas factory and DOM polyfills (DOMMatrix, Path2D) are wired to
 * @napi-rs/canvas specifically — node-canvas produced silently blank
 * output under v6 (verified: valid JPEGs, zero non-white pixels) because
 * pdfjs's internal compositing relies on those polyfills being present.
 */

const pdfjsPath = path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'))

export type PdfRasterizer = {
  pageCount: number
  /** Render one page, run cleanup, and return its PNG bytes. Safe to call sequentially, page by page. */
  renderPage: (pageNumber: number) => Promise<Buffer>
  /** Release the underlying pdfjs document. Call once after all pages are processed. */
  destroy: () => Promise<void>
}

export async function openPdfForRasterizing(
  pdfPath: string,
  options: { scale: number },
): Promise<PdfRasterizer> {
  const data = new Uint8Array(await readFile(pdfPath))

  // getDocument() returns a PDFDocumentLoadingTask synchronously; .destroy()
  // lives on this loading task, NOT on the resolved PDFDocumentProxy (the
  // proxy has no destroy() method as of pdfjs-dist v6) — keep the task
  // reference so we can release the worker/document when done.
  const loadingTask = pdfjsLib.getDocument({
    standardFontDataUrl: path.join(pdfjsPath, `standard_fonts${path.sep}`),
    cMapUrl: path.join(pdfjsPath, `cmaps${path.sep}`),
    cMapPacked: true,
    // Required for image codecs pdfjs lazy-loads at decode time (JBIG2,
    // OpenJPEG/JPX) — common in scanned/faxed documents. Without this,
    // pdfjs can't locate its own wasm/ directory and fails to decode
    // those images (seen as "JBig2Error: JBig2 failed to initialize" /
    // "Cannot find package 'nulljbig2_nowasm_fallback.js'" — the "null"
    // prefix is pdfjs concatenating onto an unset wasmUrl).
    wasmUrl: path.join(pdfjsPath, `wasm${path.sep}`),
    data,
  })
  const pdfDocument = await loadingTask.promise

  async function renderPage(pageNumber: number): Promise<Buffer> {
    const page = await pdfDocument.getPage(pageNumber)
    let canvas: Canvas | null = createCanvas(1, 1)
    try {
      const viewport = page.getViewport({ scale: options.scale })
      canvas.width = viewport.width
      canvas.height = viewport.height
      const context = canvas.getContext('2d')

      await page.render({
        canvas,
        canvasContext: context,
        viewport,
      }).promise

      return canvas.toBuffer('image/png')
    }
    finally {
      // Explicitly release native canvas pixel memory (napi-rs canvas is
      // a native binding; zeroing dimensions and dropping the reference
      // prompts immediate reclamation instead of waiting on GC).
      if (canvas !== null) {
        canvas.width = 0
        canvas.height = 0
      }
      canvas = null

      // Release pdfjs's per-page cached resources (decoded fonts, images,
      // operator lists) — this is the call pdf-to-img omits, and the main
      // fix for cross-page memory accumulation in long documents.
      page.cleanup()
    }
  }

  async function destroy(): Promise<void> {
    await loadingTask.destroy()
  }

  return { pageCount: pdfDocument.numPages, renderPage, destroy }
}
