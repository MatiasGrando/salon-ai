import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const schema = readFileSync('prisma/schema.prisma', 'utf8')
const server = readFileSync('src/server.ts', 'utf8')
const route = readFileSync('src/routes/workshop.ts', 'utf8')
const ui = readFileSync('src/routes/crm-ui.ts', 'utf8')

assert.match(schema, /enum WorkshopVehicleUsage\s*{[\s\S]*PARTICULAR[\s\S]*FREQUENT[\s\S]*PROFESSIONAL[\s\S]*}/)
assert.match(schema, /model WorkshopBrand\s*{[\s\S]*@@unique\(\[businessId, normalizedName\]\)[\s\S]*}/)
assert.match(schema, /model WorkshopVehicle\s*{[\s\S]*@@unique\(\[businessId, plate\]\)[\s\S]*}/)
assert.match(schema, /year\s+Int\?/)
assert.match(schema, /customerId\s+String/)
assert.match(server, /import \{ workshopRoutes \} from '\.\/routes\/workshop\.js'/)
assert.match(server, /register\(workshopRoutes\)/)

for (const endpoint of [
  "app.get('/workshop/brands'",
  "app.post('/workshop/brands'",
  "app.get('/workshop/vehicles'",
  "app.get('/workshop/vehicles/:id'",
  "app.post('/workshop/vehicles'"
]) assert.ok(route.includes(endpoint), endpoint)
assert.match(route, /loadAuthorizedBusiness/)
assert.match(route, /businessType\s*!==\s*'WORKSHOP'/)
assert.match(route, /businessId/)

for (const marker of [
  'id="workshop-vehicle-search"',
  'id="workshop-add-vehicle"',
  'id="workshop-vehicle-form"',
  'id="workshop-brand-input"',
  'id="workshop-brand-menu"',
  'Agregar marca',
  'WORKSHOP_DEFAULT_BRAND_NAMES',
  'WORKSHOP_BRAND_MIN_QUERY_LENGTH = 1',
  'function renderWorkshopBrandMenu',
  'data-workshop-brand-add',
  '@container workshop-vehicle',
  'id="workshop-vehicle-list"',
  'class="workshop-vehicle-table"',
  '<th>Patente</th>',
  '<th>Modelo</th>',
  '<th>Contacto</th>',
  '<th>Tel&eacute;fono</th>',
  'function formatWorkshopPhoneInput',
  'function formatWorkshopMileageInput',
  'class="workshop-form-grid workshop-form-grid-vehicle"',
  'class="workshop-form-grid workshop-form-grid-contact"',
  'Categor&iacute;a de uso',
  'workshop-dialog-close',
  'workshop-dialog-resize-grip',
  'WORKSHOP_VEHICLE_DIALOG_SIZE_KEY',
  'new ResizeObserver',
  'localStorage.setItem(WORKSHOP_VEHICLE_DIALOG_SIZE_KEY',
  '--workshop-field-height',
  'function syncWorkshopDialogInteriorScale',
  "els.workshopVehiclePlate.value = normalizeWorkshopPlateSearch(els.workshopVehiclePlate.value)",
  'data-workshop-vehicle-id',
  'function handleWorkshopGlobalPlateKey',
  'WORKSHOP_VEHICLE_SEARCH_DELAY_MS = 300',
  'setTimeout(() => loadWorkshopVehicles',
  'Escrib&iacute; una patente para buscar un veh&iacute;culo.',
  "getJson('/workshop/vehicles?",
  "getJson('/workshop/brands?",
  "setSection('autos')"
]) assert.ok(ui.includes(marker), marker)
assert.doesNotMatch(ui, /state\.workshopVehicles\.filter\(\(vehicle\) => vehicle\.plate\.startsWith/)
for (const marker of [
  'workshop-detail-identity',
  'workshop-detail-plate',
  'workshop-detail-card-icon',
  'workshop-detail-action',
  'Editar datos'
]) assert.ok(ui.includes(marker), marker)
const workshopDialogMarkup = ui.slice(ui.indexOf('id="workshop-vehicle-dialog"'), ui.indexOf('class="workshop-view workshop-jobs-view"'))
assert.match(workshopDialogMarkup, /id="workshop-vehicle-year"[^>]*placeholder="Ej: 2021"/)
assert.doesNotMatch(workshopDialogMarkup, /id="workshop-vehicle-year"[^>]*required/)
assert.match(workshopDialogMarkup, /id="workshop-vehicle-mileage"[^>]*type="text"[^>]*inputmode="numeric"[^>]*placeholder="82\.400"/)
assert.doesNotMatch(workshopDialogMarkup, /id="workshop-brand-input"[^>]*\slist=/)
assert.doesNotMatch(workshopDialogMarkup, /id="workshop-brand-add"/)
const workshopVehicleSaveScript = ui.slice(ui.indexOf('async function saveWorkshopVehicle'), ui.indexOf('function setWorkshopVehicleSearch'))
assert.doesNotMatch(workshopVehicleSaveScript, /await addWorkshopBrand\(\)/)
assert.match(workshopVehicleSaveScript, /Eleg&iacute; una marca de la lista/)
assert.ok(workshopDialogMarkup.indexOf('id="workshop-contact-name"') < workshopDialogMarkup.indexOf('id="workshop-vehicle-usage"'))
assert.doesNotMatch(workshopDialogMarkup, /M&aacute;s detalles|workshop-contact-address|Direcci&oacute;n/)
assert.doesNotMatch(workshopDialogMarkup, /workshop-vehicle-cancel/)
assert.doesNotMatch(ui, /workshopVehicleDialog\?\.addEventListener\('click'/)
assert.doesNotMatch(ui, /(?:alert|confirm|prompt)\s*\(/)

const db = new PGlite()
await db.exec(`
  CREATE TYPE "BusinessType" AS ENUM ('SALON', 'WORKSHOP');
  CREATE TABLE "Business" (id TEXT PRIMARY KEY, "businessType" "BusinessType" NOT NULL DEFAULT 'SALON');
  CREATE TABLE "Customer" (id TEXT PRIMARY KEY, "businessId" TEXT NOT NULL);
  CREATE UNIQUE INDEX "Customer_businessId_id_key" ON "Customer"("businessId", id);
`)
await db.exec(readFileSync('prisma/migrations/20260907233000_add_workshop_vehicles/migration.sql', 'utf8'))
await db.exec(readFileSync('prisma/migrations/20260908210000_workshop_vehicle_year_optional/migration.sql', 'utf8'))
await db.exec(`
  INSERT INTO "Business" (id, "businessType") VALUES ('a', 'WORKSHOP'), ('b', 'WORKSHOP');
  INSERT INTO "Customer" (id, "businessId") VALUES ('customer-a', 'a'), ('customer-b', 'b');
  INSERT INTO "WorkshopBrand" (id, "businessId", name, "normalizedName", "createdAt", "updatedAt") VALUES
    ('brand-a', 'a', 'Renault', 'renault', now(), now()),
    ('brand-b', 'b', 'RENAULT', 'renault', now(), now());
  INSERT INTO "WorkshopVehicle" (id, "businessId", "brandId", "customerId", plate, model, year, engine, "currentMileage", usage, "createdAt", "updatedAt") VALUES
    ('vehicle-a', 'a', 'brand-a', 'customer-a', 'AB123CD', 'Kangoo', 2020, '1.6', 82400, 'PARTICULAR', now(), now()),
    ('vehicle-b', 'b', 'brand-b', 'customer-b', 'AB123CD', 'Kangoo', 2020, '1.6', 82400, 'PROFESSIONAL', now(), now());
`)
await assert.rejects(db.exec(`INSERT INTO "WorkshopBrand" (id, "businessId", name, "normalizedName", "createdAt", "updatedAt") VALUES ('brand-a2', 'a', 'RENAULT', 'renault', now(), now())`))
await assert.rejects(db.exec(`INSERT INTO "WorkshopVehicle" (id, "businessId", "brandId", "customerId", plate, model, year, engine, usage, "createdAt", "updatedAt") VALUES ('vehicle-a2', 'a', 'brand-a', 'customer-a', 'AB123CD', 'Otro', 2020, '1.6', 'PARTICULAR', now(), now())`))
await db.exec(`INSERT INTO "WorkshopVehicle" (id, "businessId", "brandId", "customerId", plate, model, year, engine, usage, "createdAt", "updatedAt") VALUES ('vehicle-yearless', 'a', 'brand-a', 'customer-a', 'AC123DE', 'Historico', NULL, '1.6', 'PARTICULAR', now(), now())`)
await db.close()

console.log('Workshop vehicle contracts passed (schema, migration, routes and CRM UI)')
