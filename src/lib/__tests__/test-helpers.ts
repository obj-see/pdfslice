import { writeFile } from 'node:fs/promises'
import { PDFDocument, rgb } from 'pdf-lib'
import { createLogger, transports } from 'winston'

/** Generates a simple N-page PDF at `filePath` for use in tests. */
export async function makeTestPdf(
  filePath: string,
  pageCount: number,
): Promise<void> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pageCount; i++) {
    const page = doc.addPage([200, 200])
    page.drawText(`Page ${i + 1}`, {
      x: 20,
      y: 100,
      size: 18,
      color: rgb(0, 0, 0),
    })
  }
  await writeFile(filePath, await doc.save())
}

/** A winston logger that discards everything, for quiet test output. */
export function silentLogger() {
  return createLogger({
    transports: [
      new transports.Console({ silent: true }),
    ],
  })
}
