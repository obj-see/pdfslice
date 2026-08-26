# pdfslice

PDF page-image splitter, gatherer, and integrity checker.

pdfslice helps you break a PDF into one image per page, keep a manifest of the split output, verify whether all page images are present, and rebuild a PDF from those images when needed.

## About the Project

This project is designed for workflows where PDF pages need to be processed as images without losing the source document structure. It keeps the original PDF intact, writes page-level JPG files into a folder beside the source, and records metadata so the project can later verify or reconstruct the full document.

### Features

- Split PDF files into per-page JPG images
- Keep a manifest with page hashes and metadata
- Check for missing page images without rewriting a PDF
- Gather page images back into a single PDF
- Optionally flatten output folders across a directory tree
- Support dry-run mode for safe previewing

## Getting Started

### Prerequisites

- Node.js
- pnpm

### Install dependencies

```bash
pnpm install
```

### Build the project

```bash
pnpm build
```

## Usage

The CLI exposes three commands:

```bash
pdfslice split <input> [--level <n>] [--flatten] [--template <string>] [--force] [--dry-run] [--verbose] [--quiet]
pdfslice gather <input> [--backup] [--dry-run] [--verbose] [--quiet]
pdfslice check <input> [--verbose] [--quiet]
```

### 1) Split a PDF into images

```bash
pdfslice split ./documents
```

This scans the target folder for PDF files and creates a folder for each PDF, for example:

```text
documents/
├── sample.pdf
└── sample/
    ├── sample.001.jpg
    ├── sample.002.jpg
    ├── sample.003.jpg
    ├── sample.pdf
    └── .pdfslice-manifest.json
```

The original PDF is preserved and copied into the generated output folder.

#### Directory search depth

```bash
pdfslice split ./documents --level 2
```

Use `--level` to control how deep the search should go when scanning nested folders.

#### Flatten output

```bash
pdfslice split ./documents --flatten
```

This places each generated output folder at the input root instead of beside each source PDF.

#### Skip already-processed PDFs (default)

By default, `split` skips a PDF entirely if its output folder already has a
matching manifest (same PDF content hash, same template) — no
re-rasterization on repeat runs.

```bash
pdfslice split ./documents --force
```

Pass `--force` to re-split anyway, even if nothing changed.

#### Custom filename template

```bash
pdfslice split ./documents --template "page-{{page_number}}.jpg"
```

Use `{{filename}}` and `{{page_number}}` placeholders to control the page image filename (default: `{{filename}}.{{page_number}}.jpg`). Exactly one `{{page_number}}` is required. The template is saved in the manifest, so `gather`/`check` parse page numbers back out correctly without needing `--template` repeated.

### 2) Gather images back into a PDF

```bash
pdfslice gather ./documents/sample
```

This rebuilds a combined PDF from the page images in the split unit folder and **overwrites the original PDF in place** (same filename, same location). A backup of the previous PDF (`sample.bak-<timestamp>.pdf`) is created first by default — pass `--no-backup` to skip it.

If the PDF already reflects the current images (nothing has changed since the last gather), the project skips unnecessary regeneration.

### 3) Check for missing page images

```bash
pdfslice check ./documents/sample
```

This reports missing pages without creating a PDF output.

## Common flags

- `--dry-run`: preview actions without writing files
- `--backup` (gather only, default on): back up the existing PDF before overwriting it; use `--no-backup` to skip
- `--template <string>` (split only): custom page-image filename template
- `--force` (split only): re-split even if the output already matches this PDF (skipped by default)
- `--verbose`: print debug logging
- `--quiet`: print only errors
- `--log-file <path>`: write logs to JSON as well as console

## Example workflow

```bash
pdfslice split ./input --level 2
pdfslice check ./input/report
pdfslice gather ./input/report
```

## Project Structure

```text
src/
├── app.ts
├── context.ts
├── bin/
│   ├── bash-complete.ts
│   └── cli.ts
├── commands/
│   ├── check/
│   ├── gather/
│   └── split/
├── lib/
│   ├── discover.ts
│   ├── gather.ts
│   ├── hash.ts
│   ├── logger.ts
│   ├── manifest.ts
│   └── split.ts
└── lib/__tests__/
```

## Contributing

Contributions are welcome.

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run the relevant checks and tests
5. Open a pull request

Please also read the [CONTRIBUTING.md](CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) files.

## License

This project is licensed under the Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International License.

See [LICENSE.md](LICENSE.md) for the full text.

## Repository

- GitHub: https://github.com/DuckyMomo20012/pdfslice
- Author: DuckyMomo20012
