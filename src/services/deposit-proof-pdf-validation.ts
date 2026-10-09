import { createHash } from 'node:crypto'
import { inflateSync } from 'node:zlib'
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib'
import { DEPOSIT_PROOF_MAX_BYTES } from './deposit-proof-image-validation.js'

export type DepositProofValidationErrorCode = 'UNSUPPORTED_MEDIA_TYPE' | 'TOO_LARGE' | 'MAGIC_MISMATCH' | 'INVALID_IMAGE' | 'DERIVED_TOO_LARGE'
  | 'INVALID_PDF' | 'UNSAFE_PDF' | 'PDF_LIMIT_EXCEEDED' | 'UNSUPPORTED_PDF_FEATURE'
export class DepositProofValidationError extends Error {
  constructor(readonly code: DepositProofValidationErrorCode) { super(code) }
}
export type DepositProofPdfValidationResult = {
  sourceData: Buffer; sourceMimeType: 'application/pdf'; sourceFilename: string; sourceByteSize: number; sourceSha256: string
  derivedData: Buffer; derivedMimeType: 'application/pdf'; derivedByteSize: number; derivedSha256: string; validatorVersion: 'f8-pdf-v1'
}
const MAX_STREAM_BYTES = 1024 * 1024
const MAX_TOTAL_STREAM_BYTES = 8 * MAX_STREAM_BYTES
const MAX_OBJECTS = 2000
const MAX_PAGES = 10
const FORBIDDEN_NAMES = new Set(['Encrypt', 'OpenAction', 'AA', 'A', 'Action', 'JavaScript', 'JS', 'EmbeddedFiles', 'EmbeddedFile',
  'Filespec', 'EF', 'AF', 'Collection', 'AcroForm', 'XFA', 'Launch', 'URI', 'GoToR', 'SubmitForm', 'ImportData', 'RichMedia', 'Rendition', 'Movie', 'Sound', '3D'])
const UNSUPPORTED_NAMES = new Set(['ObjStm', 'XRef'])
const decodedNames = (text: string) => text.replace(/#[0-9a-f]{2}/gi, (escape) => String.fromCharCode(Number.parseInt(escape.slice(1), 16)))
function assertPassiveNames(text: string) {
  for (const name of decodedNames(text).matchAll(/\/([^\s\x00()<>\[\]{}\/%]+)/g)) {
    if (FORBIDDEN_NAMES.has(name[1]!)) throw new DepositProofValidationError('UNSAFE_PDF')
    if (UNSUPPORTED_NAMES.has(name[1]!)) throw new DepositProofValidationError('UNSUPPORTED_PDF_FEATURE')
  }
}

/** A deliberately conservative preflight, not a general PDF decoder.
 * Every raw stream must have a direct length and a single supported filter.
 * Compressed object/xref streams are excluded globally BEFORE pdf-lib runs.
 * Uncommon legal PDFs fail closed and the customer can send a capture instead.
 */
function preflight(data: Buffer) {
  const raw = data.toString('latin1')
  if (!/^%PDF-[12]\.\d[\r\n]/.test(raw) || !/%%EOF[\x00\t\n\f\r ]*$/.test(raw)) throw new DepositProofValidationError('INVALID_PDF')
  // Scan the entire raw document, including strings/stream bodies. False positives
  // are preferable to letting indirect or escaped Type names trigger library inflation.
  assertPassiveNames(raw)
  const objectCount = [...raw.matchAll(/\bobj\b/g)].length
  if (objectCount > MAX_OBJECTS) throw new DepositProofValidationError('PDF_LIMIT_EXCEEDED')
  let decodedTotal = 0, cursor = 0
  const structural: string[] = []
  const streams = /\bstream\b/g
  let match: RegExpExecArray | null
  while ((match = streams.exec(raw))) {
    const outside = raw.slice(cursor, match.index)
    structural.push(outside)
    assertPassiveNames(outside)
    const eol = raw.slice(streams.lastIndex).match(/^(?:\r\n|\r|\n)/)?.[0]
    if (!eol) throw new DepositProofValidationError('UNSUPPORTED_PDF_FEATURE')
    const objectHeaders = [...outside.matchAll(/\b\d+\s+\d+\s+obj\b/g)]
    const header = objectHeaders.at(-1)
    if (!header) throw new DepositProofValidationError('UNSUPPORTED_PDF_FEATURE')
    const dictionary = decodedNames(outside.slice(header.index))
    if (!/>>\s*$/.test(dictionary)) throw new DepositProofValidationError('INVALID_PDF')
    const lengths = [...dictionary.matchAll(/\/Length\b/g)]
    const direct = dictionary.match(/\/Length\s+(\d+)\s*(?=\/|>>)/)
    if (lengths.length !== 1 || !direct) throw new DepositProofValidationError('UNSUPPORTED_PDF_FEATURE')
    const length = Number(direct[1])
    const start = streams.lastIndex + eol.length, end = start + length
    if (!Number.isSafeInteger(length) || length < 0 || end > data.length) throw new DepositProofValidationError('INVALID_PDF')
    const ending = raw.slice(end).match(/^(?:\r\n|\r|\n)?endstream\b/)
    if (!ending) throw new DepositProofValidationError('INVALID_PDF')
    const filters = [...dictionary.matchAll(/\/Filter\b/g)]
    const filter = dictionary.match(/\/Filter\s*\/([A-Za-z0-9]+)/)?.[1]
    if (filters.length > 1 || (filters.length && !['FlateDecode', 'DCTDecode'].includes(filter ?? ''))
      || /\/DecodeParms\b/.test(dictionary)) throw new DepositProofValidationError('UNSUPPORTED_PDF_FEATURE')
    let decoded = data.subarray(start, end)
    if (filter === 'FlateDecode') {
      try { decoded = inflateSync(decoded, { maxOutputLength: MAX_STREAM_BYTES }) }
      catch (error) {
        if ((error as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE') throw new DepositProofValidationError('PDF_LIMIT_EXCEEDED')
        throw new DepositProofValidationError('INVALID_PDF')
      }
    }
    decodedTotal += decoded.length
    if (decoded.length > MAX_STREAM_BYTES || decodedTotal > MAX_TOTAL_STREAM_BYTES) throw new DepositProofValidationError('PDF_LIMIT_EXCEEDED')
    if (filter !== 'DCTDecode') {
      const decodedText = decoded.toString('latin1')
      assertPassiveNames(decodedText)
    }
    cursor = end + ending[0].length
    streams.lastIndex = cursor
  }
  structural.push(raw.slice(cursor))
  assertPassiveNames(raw.slice(cursor))
  // Bound recursive object syntax before the library parser. Conservative:
  // delimiters inside strings may reject an uncommon but otherwise valid PDF.
  let depth = 0
  for (const token of structural.join('\n').matchAll(/<<|>>|\[|\]/g)) {
    depth += token[0] === '<<' || token[0] === '[' ? 1 : -1
    if (depth < 0) throw new DepositProofValidationError('INVALID_PDF')
    if (depth > 32) throw new DepositProofValidationError('PDF_LIMIT_EXCEEDED')
  }
  if (depth !== 0) throw new DepositProofValidationError('INVALID_PDF')
}
function inspectParsedObjects(doc: PDFDocument) {
  const objects = doc.context.enumerateIndirectObjects()
  if (objects.length > MAX_OBJECTS) throw new DepositProofValidationError('PDF_LIMIT_EXCEEDED')
  const seen = new Set<unknown>()
  const queue: unknown[] = objects.map((entry) => entry[1])
  while (queue.length) {
    const object = queue.pop()
    if (!object || seen.has(object)) continue
    seen.add(object)
    if (seen.size > 20000) throw new DepositProofValidationError('PDF_LIMIT_EXCEEDED')
    if (object instanceof PDFName && FORBIDDEN_NAMES.has(object.decodeText())) throw new DepositProofValidationError('UNSAFE_PDF')
    if (object instanceof PDFRawStream) queue.push(object.dict)
    if (object instanceof PDFDict) for (const [key, value] of object.entries()) queue.push(key, value)
    if (object instanceof PDFArray) queue.push(...object.asArray())
  }
  // A corrupt cyclic/repeated page tree must not reach getPageCount traversal.
  const pages: Array<{ value: unknown; depth: number }> = [{ value: doc.catalog.get(PDFName.of('Pages')), depth: 0 }]
  const visitedPages = new Set<unknown>()
  let leafCount = 0
  while (pages.length) {
    const node = pages.pop()!
    const value = doc.context.lookup(node.value as any)
    if (!(value instanceof PDFDict) || visitedPages.has(value)) throw new DepositProofValidationError('INVALID_PDF')
    visitedPages.add(value)
    if (node.depth > 32 || visitedPages.size > MAX_OBJECTS) throw new DepositProofValidationError('PDF_LIMIT_EXCEEDED')
    const type = value.get(PDFName.of('Type'))
    if (type instanceof PDFName && type.decodeText() === 'Page') {
      leafCount++
      if (leafCount > MAX_PAGES) throw new DepositProofValidationError('PDF_LIMIT_EXCEEDED')
    } else {
      const kids = doc.context.lookup(value.get(PDFName.of('Kids')) as any)
      if (!(type instanceof PDFName) || type.decodeText() !== 'Pages' || !(kids instanceof PDFArray)) throw new DepositProofValidationError('INVALID_PDF')
      for (const child of kids.asArray()) pages.push({ value: child, depth: node.depth + 1 })
    }
  }
  if (!leafCount || doc.getPageCount() !== leafCount) throw new DepositProofValidationError('INVALID_PDF')
}
export async function validateDepositProofPdf(input: { data: Uint8Array; declaredMimeType?: string | null; filename?: string | null }): Promise<DepositProofPdfValidationResult> {
  const sourceData = Buffer.from(input.data)
  if (!sourceData.length || sourceData.length > DEPOSIT_PROOF_MAX_BYTES) throw new DepositProofValidationError('TOO_LARGE')
  if (String(input.declaredMimeType ?? '').trim().toLowerCase() !== 'application/pdf') throw new DepositProofValidationError('MAGIC_MISMATCH')
  preflight(sourceData)
  try {
    const doc = await PDFDocument.load(sourceData, { ignoreEncryption: false, throwOnInvalidObject: true, updateMetadata: false })
    inspectParsedObjects(doc)
  } catch (error) {
    if (error instanceof DepositProofValidationError) throw error
    throw new DepositProofValidationError('INVALID_PDF')
  }
  const stem = (String(input.filename ?? '').replace(/\\/g, '/').split('/').pop() ?? '').replace(/(?:\.[^.]+)+$/, '')
    .replace(/[\u0000-\u001f\u007f]/g, '').replace(/[^a-zA-Z0-9 _.-]/g, '_').trim().slice(0, 120).replace(/[. ]+$/g, '')
  const hash = createHash('sha256').update(sourceData).digest('hex')
  // PDF is retained as a validated passive document, not rendered or called sanitized.
  return { sourceData, sourceMimeType: 'application/pdf', sourceFilename: stem ? `${stem}.pdf` : 'comprobante.pdf', sourceByteSize: sourceData.length,
    sourceSha256: hash, derivedData: Buffer.from(sourceData), derivedMimeType: 'application/pdf', derivedByteSize: sourceData.length, derivedSha256: hash, validatorVersion: 'f8-pdf-v1' }
}
