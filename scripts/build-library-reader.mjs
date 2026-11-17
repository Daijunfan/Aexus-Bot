import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const readerRoot = path.join(root, 'resources', 'library-reader')

for (const required of ['runtime.cjs', 'schema.json', 'API.md', 'ui/index.html', 'lib/preview-worker.cjs']) {
  if (!fs.existsSync(path.join(readerRoot, required))) {
    throw Error('Missing built-in Study Reader file: resources/library-reader/' + required)
  }
}

const pdfRoot = path.dirname(path.resolve(root, 'node_modules/pdfjs-dist/package.json'))
const katexRoot = path.dirname(path.resolve(root, 'node_modules/katex/package.json'))
if (!fs.existsSync(path.join(pdfRoot, 'package.json'))) throw Error('Missing root pdfjs-dist dependency')
if (!fs.existsSync(path.join(katexRoot, 'package.json'))) throw Error('Missing root katex dependency')

const vendor = path.join(readerRoot, 'ui', 'vendor')
fs.rmSync(vendor, { recursive: true, force: true })
fs.mkdirSync(vendor, { recursive: true })

for (const [source, destination] of [
  ['build/pdf.mjs', 'pdf.mjs'],
  ['build/pdf.worker.mjs', 'pdf.worker.mjs'],
  ['web/pdf_viewer.css', 'pdf_viewer.css'],
  ['web/images', 'images'],
  ['cmaps', 'cmaps'],
  ['standard_fonts', 'standard_fonts'],
  ['wasm', 'wasm'],
  ['LICENSE', 'PDFJS-LICENSE'],
]) {
  const from = path.join(pdfRoot, source)
  if (fs.existsSync(from)) fs.cpSync(from, path.join(vendor, destination), { recursive: true })
}

fs.cpSync(path.join(katexRoot, 'dist'), path.join(vendor, 'katex'), { recursive: true })
console.log('Built Library Study Reader assets: ' + path.relative(root, vendor))
