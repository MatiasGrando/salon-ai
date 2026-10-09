import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { deflateSync } from 'node:zlib'
import { PDFDocument, PDFName, PDFRawStream, PDFString } from 'pdf-lib'
import sharp from 'sharp'
import { PGlite } from '@electric-sql/pglite'
import Fastify from 'fastify'
import ts from 'typescript'
import { Prisma } from '../src/generated/prisma/client.js'
import { sendAuthorizationFailure } from '../src/services/authorization-response.js'
import { canStaffAccessRoute, STAFF_PRESET_DEFINITIONS } from '../src/services/staff-permission-service.js'
import { validateDepositProof, DepositProofValidationError } from '../src/services/deposit-proof-validation.js'
import { validateDepositProofImage, DEPOSIT_PROOF_MAX_BYTES } from '../src/services/deposit-proof-image-validation.js'

// Synthetic receipts only: no environment, banking data, network or real reservations.
async function fixture(options: { pages?: number; objects?: boolean; active?: string; stream?: Uint8Array; filter?: string } = {}) {
  const doc = await PDFDocument.create()
  for (let i = 0; i < (options.pages ?? 1); i++) doc.addPage([200, 200])
  if (options.active) doc.catalog.set(PDFName.of(options.active), PDFString.of('offline fixture'))
  if (options.stream) {
    const dictionary = doc.context.obj(options.filter ? { Filter: PDFName.of(options.filter) } : {})
    const ref = doc.context.register(PDFRawStream.of(dictionary, options.stream))
    doc.getPage(0).node.set(PDFName.of('Contents'), ref)
  }
  return Buffer.from(await doc.save({ useObjectStreams: options.objects ?? false }))
}
const pdf = await fixture()
const pdfInput = { data: pdf, declaredMimeType: 'application/pdf', filename: '../../receipt.exe' }
const evidence = await validateDepositProof(pdfInput)
assert.equal(evidence.sourceMimeType, 'application/pdf')
assert.equal(evidence.derivedMimeType, 'application/pdf')
assert.equal(evidence.validatorVersion, 'f8-pdf-v1')
assert.equal(evidence.sourceFilename, 'receipt.pdf')
assert.deepEqual(evidence.sourceData, pdf)
assert.equal(evidence.sourceSha256, createHash('sha256').update(pdf).digest('hex'))
assert.equal(evidence.derivedSha256, createHash('sha256').update(evidence.derivedData).digest('hex'))
assert.equal(evidence.sourceByteSize, pdf.length)
assert.equal(evidence.derivedByteSize, evidence.derivedData.length)
const compressedObjects = await fixture({ objects: true })
const fails = (data: Uint8Array, declaredMimeType: string, code?: string) => assert.rejects(
  () => validateDepositProof({ data, declaredMimeType }),
  (error: unknown) => error instanceof DepositProofValidationError && (!code || error.code === code)
)
// Conservative classic subset: the library resolves Type references before decoding.
// This regression used to bypass the preflight depth budget through an indirect ObjStm.
await fails(compressedObjects, 'application/pdf', 'UNSUPPORTED_PDF_FEATURE')
const indirectDoc = await PDFDocument.create()
indirectDoc.addPage()
const indirectType = indirectDoc.context.register(PDFName.of('ObjStm'))
const indirectPayload = deflateSync(Buffer.from('9999 0 ' + '['.repeat(60) + '0' + ']'.repeat(60)))
indirectDoc.context.register(PDFRawStream.of(indirectDoc.context.obj({ Type: indirectType, N: 1, First: 7, Filter: PDFName.of('FlateDecode') }), indirectPayload))
const indirectPdf = Buffer.from(await indirectDoc.save({ useObjectStreams: false }))
await fails(indirectPdf, 'application/pdf', 'UNSUPPORTED_PDF_FEATURE')
await fails(pdf, 'image/png', 'MAGIC_MISMATCH')
await fails(Buffer.from('%PDF-1.7\nnot a PDF\n%%EOF'), 'application/pdf', 'INVALID_PDF')
await fails(pdf.subarray(0, pdf.length - 15), 'application/pdf', 'INVALID_PDF')
await fails(Buffer.concat([pdf, Buffer.from('<script>active trailing payload</script>')]), 'application/pdf', 'INVALID_PDF')
await fails(Buffer.alloc(DEPOSIT_PROOF_MAX_BYTES + 1), 'application/pdf', 'TOO_LARGE')
await fails(Buffer.from('unsupported office document'), 'application/msword', 'UNSUPPORTED_MEDIA_TYPE')
for (const key of ['OpenAction', 'AA', 'JavaScript', 'JS', 'EmbeddedFiles', 'RichMedia', 'Launch', 'XFA', 'Encrypt']) {
  await fails(await fixture({ active: key }), 'application/pdf', 'UNSAFE_PDF')
}
await fails(await fixture({ pages: 11 }), 'application/pdf', 'PDF_LIMIT_EXCEEDED')
await fails(await fixture({ stream: deflateSync(Buffer.alloc(1024 * 1024 + 1, 65)), filter: 'FlateDecode' }), 'application/pdf', 'PDF_LIMIT_EXCEEDED')
await fails(await fixture({ stream: Buffer.from('ASCII85 payload'), filter: 'ASCII85Decode' }), 'application/pdf', 'UNSUPPORTED_PDF_FEATURE')
const safeStream = await fixture({ stream: deflateSync(Buffer.from('q Q')), filter: 'FlateDecode' })
await validateDepositProof({ data: safeStream, declaredMimeType: 'application/pdf' })
await fails(Buffer.from(safeStream.toString('latin1').replace(/\/Length\s+\d+/, '/Length 1 0 R'), 'latin1'), 'application/pdf', 'UNSUPPORTED_PDF_FEATURE')
await fails(Buffer.from(safeStream.toString('latin1').replace('/Filter /FlateDecode', '/Filter [/FlateDecode /FlateDecode]'), 'latin1'), 'application/pdf', 'UNSUPPORTED_PDF_FEATURE')
await fails(Buffer.from(compressedObjects.toString('latin1').replace('/ObjStm', '/Obj#53tm'), 'latin1'), 'application/pdf', 'UNSUPPORTED_PDF_FEATURE')
const largeObjects = await PDFDocument.create()
largeObjects.addPage()
for (let i = 0; i < 2001; i++) largeObjects.context.register(PDFString.of('offline'))
await fails(await largeObjects.save({ useObjectStreams: false }), 'application/pdf', 'PDF_LIMIT_EXCEEDED')
const manyStreams = await PDFDocument.create()
manyStreams.addPage()
const nearLimitStream = deflateSync(Buffer.alloc(1024 * 1024, 65))
for (let i = 0; i < 9; i++) manyStreams.context.register(PDFRawStream.of(manyStreams.context.obj({ Filter: PDFName.of('FlateDecode') }), nearLimitStream))
await fails(await manyStreams.save({ useObjectStreams: false }), 'application/pdf', 'PDF_LIMIT_EXCEEDED')
const escapedAction = (await fixture({ active: 'OpenAction' })).toString('latin1').replace('/OpenAction', '/Open#41ction')
await fails(Buffer.from(escapedAction, 'latin1'), 'application/pdf', 'UNSAFE_PDF')
const image = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'white' } }).png().toBuffer()
const imageInput = { data: image, declaredMimeType: 'image/png', filename: 'picture.png' }
assert.deepEqual(await validateDepositProof(imageInput), await validateDepositProofImage(imageInput), 'existing image sanitation is unchanged')

// Original SQL is executed verbatim. The new migration only changes MIME constraints.
const db = new PGlite()
await db.exec('CREATE TABLE "Business" (id text PRIMARY KEY); CREATE TABLE "BookingDeposit" (id text PRIMARY KEY, "businessId" text, UNIQUE("businessId",id)); INSERT INTO "Business" VALUES (\'b\'),(\'foreign\'); INSERT INTO "BookingDeposit" VALUES (\'d\',\'b\');')
const original = readFileSync(new URL('../prisma/migrations/20260827130000_add_f8_append_only_deposit_proofs/migration.sql', import.meta.url), 'utf8')
await db.exec(original)
await db.exec(readFileSync(new URL('../prisma/migrations/20261009010000_allow_f8_pdf_deposit_proofs/migration.sql', import.meta.url), 'utf8'))
let id = 0
async function insert(sourceMime: string, derivedMime: string, extras: { size?: number; hash?: string; sequence?: number; business?: string } = {}) {
  id++
  return db.query(`INSERT INTO "BookingDepositProof" (id,"businessId","depositId",sequence,kind,"validatorVersion","validatedAt","receivedAt","sourceData","sourceMimeType","sourceFilename","sourceByteSize","sourceSha256","derivedData","derivedMimeType","derivedByteSize","derivedSha256","retentionEligibleAt") VALUES ($1,$2,'d',$3,'INITIAL','offline',now(),now(),$4,$5,'offline',$6,$7,$4,$8,$6,$7,now()+interval '12 months')`,
    ['proof-' + id, extras.business ?? 'b', extras.sequence ?? 1, Buffer.from('pdf'), sourceMime, extras.size ?? 3, extras.hash ?? 'a'.repeat(64), derivedMime])
}
await insert('application/pdf', 'application/pdf')
await insert('image/png', 'image/webp', { sequence: 2 })
for (const pair of [['image/png', 'application/pdf'], ['application/pdf', 'image/webp'], ['application/msword', 'application/pdf']]) {
  await assert.rejects(() => insert(pair[0]!, pair[1]!, { sequence: 3 }))
}
await assert.rejects(() => insert('application/pdf', 'application/pdf', { sequence: 3, hash: 'invalid' }))
await assert.rejects(() => insert('application/pdf', 'application/pdf', { sequence: 3, size: 4 }))
await assert.rejects(() => insert('application/pdf', 'application/pdf', { sequence: 4 }))
await assert.rejects(() => insert('application/pdf', 'application/pdf', { sequence: 1, business: 'foreign' }))
await assert.rejects(() => db.exec('UPDATE "BookingDepositProof" SET "sourceMimeType" = \'image/png\''))
await assert.rejects(() => db.exec('DELETE FROM "BookingDepositProof"'))
await db.close()

// Exercise the actual protected CRM handler, not a replacement implementation.
const crm = readFileSync(new URL('../src/routes/crm.ts', import.meta.url), 'utf8')
const ast = ts.createSourceFile('crm.ts', crm, ts.ScriptTarget.Latest, true)
let handler = '', filenameFunction = ''
function visit(node: ts.Node) {
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.expression.getText(ast) === 'app'
    && node.expression.name.text === 'get' && node.arguments[0] && ts.isStringLiteral(node.arguments[0])
    && node.arguments[0].text === '/crm/deposits/:id/proof') handler = node.arguments[1]!.getText(ast)
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'safeMediaFilename') filenameFunction = node.getText(ast)
  ts.forEachChild(node, visit)
}
visit(ast)
assert.ok(handler)
assert.ok(filenameFunction)
async function crmProof(config: { authorized?: boolean; permission?: boolean; auth?: boolean; mime?: string; missingBytes?: boolean } = {}) {
  const app = Fastify({ logger: false })
  const audit: unknown[] = []
  let reads = 0
  const actor = { ...STAFF_PRESET_DEFINITIONS.SECRETARY_READ_ONLY.permissions, id: 'reviewer', role: 'STAFF', canManageDeposits: config.permission !== false }
  const dependencies = {
    app, Prisma, sendAuthorizationFailure, randomUUID: () => 'audit',
    authorizedBookingDepositWhere: () => ({ id: 'd', businessId: 'b' }),
    prisma: {
      bookingDeposit: { findFirst: async (input: any) => { assert.deepEqual(input.where, { id: 'd', businessId: 'b' }); return config.authorized === false ? null : { businessId: 'b', visitId: 'v', source: 'BOT' } } },
      $queryRaw: async () => { reads++; return config.missingBytes ? [] : [{ data: pdf, mimeType: config.mime ?? 'application/pdf', filename: 'receipt.pdf' }] },
      staffAuditLog: { create: async (input: unknown) => { audit.push(input) } }
    }
  }
  app.addHook('preHandler', async (request, reply) => {
    if (config.auth !== false) (request as any).auth = { user: actor }
    if (config.auth !== false && !canStaffAccessRoute(actor as any, request.method, request.url)) return sendAuthorizationFailure(reply, 'forbidden')
  })
  const javascript = ts.transpileModule(`${filenameFunction}\napp.get('/crm/deposits/:id/proof', ${handler});`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
  new Function(...Object.keys(dependencies), javascript)(...Object.values(dependencies))
  const response = await app.inject({ method: 'GET', url: '/crm/deposits/d/proof' })
  await app.close()
  return { response, audit, reads }
}
const accepted = await crmProof()
assert.equal(accepted.response.statusCode, 200)
assert.equal(accepted.response.headers['content-type'], 'application/pdf')
assert.match(String(accepted.response.headers['content-disposition']), /^attachment; filename="receipt.pdf"$/)
assert.equal(accepted.response.headers['cache-control'], 'private, no-store')
assert.equal(accepted.response.headers['x-content-type-options'], 'nosniff')
assert.equal(accepted.response.headers['content-security-policy'], "sandbox; default-src 'none'")
assert.equal(accepted.audit.length, 1)
assert.doesNotMatch(JSON.stringify(accepted.audit), /receipt\.pdf|sourceSha|derivedSha|data.*PDF/i)
for (const config of [{ authorized: false }, { permission: false }, { auth: false }, { mime: 'text/html' }, { mime: 'image/gif' }, { missingBytes: true }]) {
  const denied = await crmProof(config)
  assert.ok([401, 403, 404].includes(denied.response.statusCode))
  assert.equal(denied.audit.length, 0)
}
console.log('OK F8 proof documents: bounded structural PDF/image validation, original SQL constraints and protected CRM download; no payment interpretation or external access.')
