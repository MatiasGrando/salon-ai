import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

// Exercise the guard itself: filters are not returned relations. Each negative
// fixture must fail even when it does not contain the former `take: 1` pattern.
function assertNoMessageRelations(source: string, expectedQueries: number) {
  const file = ts.createSourceFile('crm-egress.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const diagnostics = (file as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics
  assert.equal(diagnostics.length, 0, 'the inspected source must parse')
  let queries = 0
  const nameOf = (name: ts.PropertyName): string => {
    assert.ok(ts.isIdentifier(name) || ts.isStringLiteral(name), 'computed projection names require explicit inspection')
    return name.text
  }
  const inspectProjection = (projection: ts.ObjectLiteralExpression) => {
    for (const property of projection.properties) {
      assert.ok(ts.isPropertyAssignment(property), 'projection spreads/shorthands require explicit inspection')
      const name = nameOf(property.name)
      if (name === 'messages') {
        assert.equal(property.initializer.kind, ts.SyntaxKind.FalseKeyword, 'messages must not be returned as a relation')
        continue
      }
      // Relation predicates and ordering do not materialize message history.
      if (name === 'where' || name === 'orderBy') continue
      if (ts.isObjectLiteralExpression(property.initializer)) inspectProjection(property.initializer)
      else if (ts.isIdentifier(property.initializer)) {
        // This existing selector is independently checked for binary data below.
        assert.equal(name, 'select', 'unresolved returned relation requires explicit inspection')
        assert.equal(property.initializer.text, 'conversationDepositSelect', 'unknown selector requires explicit inspection')
      } else if (name === 'include' || name === 'select') {
        assert.fail('nested projection must be explicit')
      }
    }
  }
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && /^prisma\.conversation\.(findMany|findFirst)$/.test(node.expression.getText(file))) {
      queries += 1
      const argument = node.arguments[0]
      assert.ok(argument && ts.isObjectLiteralExpression(argument), 'query arguments must be inspectable')
      let projections = 0
      const inspectArguments = (object: ts.ObjectLiteralExpression) => {
        for (const property of object.properties) {
          if (ts.isSpreadAssignment(property)) {
            let spread = property.expression
            while (ts.isParenthesizedExpression(spread)) spread = spread.expression
            // The existing cursor spread is conditional with two literal branches.
            // Inspect both; arbitrary aliases/functions remain a failing contract.
            assert.ok(ts.isConditionalExpression(spread), 'unresolved root spread requires explicit inspection')
            for (const branch of [spread.whenTrue, spread.whenFalse]) {
              assert.ok(ts.isObjectLiteralExpression(branch), 'spread branches must be explicit objects')
              inspectArguments(branch)
            }
          } else if (ts.isShorthandPropertyAssignment(property)) {
            assert.equal(property.name.text, 'where', 'projection shorthands require explicit inspection')
          } else {
            assert.ok(ts.isPropertyAssignment(property), 'query options must be inspectable')
            const name = nameOf(property.name)
            if (name !== 'include' && name !== 'select') continue
            projections += 1
            assert.ok(ts.isObjectLiteralExpression(property.initializer), 'root projection must be explicit')
            inspectProjection(property.initializer)
          }
        }
      }
      inspectArguments(argument)
      assert.ok(projections > 0, 'each conversation query must retain an explicit projection')
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  assert.equal(queries, expectedQueries, 'expected conversation query boundaries must not silently disappear')
}


const projectionFixtures: Array<{ name: string; source: string; allowed: boolean }> = [
  { name: 'search filter plus deposit limit', allowed: true,
    source: `prisma.conversation.findMany({ where: { messages: { some: { body: 'corte' } } }, include: { bookingDeposits: { take: 1 } } })` },
  { name: 'explicitly excluded messages', allowed: true,
    source: `prisma.conversation.findFirst({ include: { messages: false } })` },
  { name: 'nested relation filter', allowed: true,
    source: `prisma.conversation.findMany({ include: { bookingDeposits: { where: { conversation: { messages: { some: {} } } }, take: 1 } } })` },
  { name: 'include full history', allowed: false,
    source: `prisma.conversation.findMany({ include: { messages: true } })` },
  { name: 'include relation with take', allowed: false,
    source: `prisma.conversation.findFirst({ include: { messages: { take: 1 } } })` },
  { name: 'select full history', allowed: false,
    source: `prisma.conversation.findMany({ select: { id: true, messages: true } })` },
  { name: 'select relation with take', allowed: false,
    source: `prisma.conversation.findFirst({ select: { messages: { take: 1 } } })` },
  { name: 'nested returned history', allowed: false,
    source: `prisma.conversation.findMany({ include: { bookingDeposits: { select: { conversation: { include: { messages: true } } } } } })` },
  { name: 'unresolved projection spread', allowed: false,
    source: `prisma.conversation.findMany({ include: { ...unknownProjection } })` },
  { name: 'computed projection property', allowed: false,
    source: `prisma.conversation.findMany({ include: { [relationName]: true } })` },
  { name: 'root unknown spread', allowed: false,
    source: `prisma.conversation.findMany({ include: { bookingDeposits: true }, ...unknownArguments })` },
  { name: 'computed root projection', allowed: false,
    source: `prisma.conversation.findMany({ include: { bookingDeposits: true }, [projectionName]: { messages: true } })` },
  { name: 'root projection shorthand', allowed: false,
    source: `prisma.conversation.findMany({ include: { bookingDeposits: true }, select })` },
  { name: 'cursor conditional without hidden projection', allowed: true,
    source: `prisma.conversation.findMany({ where, include: { bookingDeposits: true }, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) })` },
  { name: 'cursor conditional with hidden history', allowed: false,
    source: `prisma.conversation.findMany({ include: { bookingDeposits: true }, ...(cursor ? { include: { messages: true } } : {}) })` },
  { name: 'missing projection', allowed: false,
    source: `prisma.conversation.findMany({ where: { id: 'one' } })` },
  { name: 'missing query', allowed: false, source: `const result = []` },
  { name: 'unresolved query argument', allowed: false,
    source: `prisma.conversation.findMany(queryArguments)` }
]
const fixtureFailures: string[] = []
for (const fixture of projectionFixtures) {
  try {
    if (fixture.allowed) assert.doesNotThrow(() => assertNoMessageRelations(fixture.source, 1), fixture.name)
    else assert.throws(() => assertNoMessageRelations(fixture.source, 1), fixture.name)
  } catch { fixtureFailures.push(fixture.name) }
}
assert.deepEqual(fixtureFailures, [], 'projection guard must distinguish returned relations from search filters')

function assertAuthMediaOmitted(source: string) {
  const file = ts.createSourceFile('auth-egress.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const propertyValue = (object: ts.ObjectLiteralExpression, name: string) => {
    assert.ok(object.properties.every(property => ts.isPropertyAssignment(property) && ts.isIdentifier(property.name)),
      'auth projection spreads/computed properties require explicit inspection')
    const properties = object.properties.filter((property): property is ts.PropertyAssignment =>
      ts.isPropertyAssignment(property) && ts.isIdentifier(property.name) && property.name.text === name)
    assert.equal(properties.length, 1, `expected one explicit ${name} property`)
    return properties[0]!.initializer
  }
  const selectors = new Map<string, ts.ObjectLiteralExpression>()
  const routes = new Map<string, ts.CallExpression>()
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) &&
        ['businessMediaOmit', 'professionalMediaOmit'].includes(node.name.text)) {
      let value = node.initializer
      while (value && (ts.isAsExpression(value) || ts.isParenthesizedExpression(value))) value = value.expression
      assert.ok(value && ts.isObjectLiteralExpression(value), 'media omit selector must remain explicit')
      assert.equal(selectors.has(node.name.text), false, 'media omit selector must be unambiguous')
      selectors.set(node.name.text, value)
    }
    if (ts.isCallExpression(node) && /^app\.(post|get)$/.test(node.expression.getText(file))) {
      const path = node.arguments[0]
      if (path && ts.isStringLiteral(path) && ['/auth/login', '/auth/me'].includes(path.text)) {
        assert.equal(routes.has(path.text), false, 'auth route must be unambiguous')
        routes.set(path.text, node)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  for (const [selector, fields] of [
    ['businessMediaOmit', ['logoUrl', 'coverImageUrl', 'landingSocialImageUrl', 'landingGalleryImages']],
    ['professionalMediaOmit', ['avatarUrl']]
  ] as const) {
    const object = selectors.get(selector)
    assert.ok(object, `missing ${selector}`)
    for (const field of fields) assert.equal(propertyValue(object, field).kind, ts.SyntaxKind.TrueKeyword, `${field} must be omitted`)
  }
  for (const path of ['/auth/login', '/auth/me']) {
    const route = routes.get(path)
    assert.ok(route, `missing ${path}`)
    let queries = 0
    const inspect = (node: ts.Node) => {
      if (ts.isCallExpression(node) && node.expression.getText(file) === 'prisma.user.findUnique') {
        queries += 1
        const argument = node.arguments[0]
        assert.ok(argument && ts.isObjectLiteralExpression(argument), 'auth query must remain explicit')
        const include = propertyValue(argument, 'include')
        assert.ok(ts.isObjectLiteralExpression(include), 'auth include must remain explicit')
        for (const [relation, selector] of [['business', 'businessMediaOmit'], ['professional', 'professionalMediaOmit']] as const) {
          const projection = propertyValue(include, relation)
          assert.ok(ts.isObjectLiteralExpression(projection), 'auth relation must remain explicit')
          const omit = propertyValue(projection, 'omit')
          assert.ok(ts.isIdentifier(omit), 'auth relation must use its checked omission selector')
          assert.equal(omit.text, selector)
        }
      }
      ts.forEachChild(node, inspect)
    }
    const callback = route.arguments[1]
    assert.ok(callback, 'auth route must retain its handler')
    inspect(callback)
    assert.equal(queries, 1, `${path} must retain its checked user query`)
  }
}

const authFixture = `
  const businessMediaOmit = { logoUrl: true, coverImageUrl: true, landingSocialImageUrl: true, landingGalleryImages: true } as const
  const professionalMediaOmit = { avatarUrl: true } as const
  app.post('/auth/login', async () => prisma.user.findUnique({ include: {
    business: { omit: businessMediaOmit, include: { featureSettings: { select: { pipelineEnabled: true } } } },
    professional: { omit: professionalMediaOmit }
  } }))
  app.get('/auth/me', async () => prisma.user.findUnique({ include: {
    business: { omit: businessMediaOmit }, professional: { omit: professionalMediaOmit }
  } }))
`
assert.doesNotThrow(() => assertAuthMediaOmitted(authFixture), 'feature-settings projection must preserve media omission')
for (const mutation of [
  authFixture.replaceAll('omit: businessMediaOmit', 'include: {}'),
  authFixture.replaceAll('omit: professionalMediaOmit', 'include: {}'),
  authFixture.replace('avatarUrl: true', 'avatarUrl: false'),
  authFixture.replace('landingGalleryImages: true', 'landingGalleryImages: false')
]) assert.throws(() => assertAuthMediaOmitted(mutation), 'removing an omission must fail')
const crmRoute = readFileSync(new URL('../src/routes/crm.ts', import.meta.url), 'utf8')
const crmUiRoute = readFileSync(new URL('../src/routes/crm-ui.ts', import.meta.url), 'utf8')
const authRoute = readFileSync(new URL('../src/routes/auth.ts', import.meta.url), 'utf8')
const businessRoute = readFileSync(new URL('../src/routes/business.ts', import.meta.url), 'utf8')
const professionalRoute = readFileSync(new URL('../src/routes/professional.ts', import.meta.url), 'utf8')
const serviceRoute = readFileSync(new URL('../src/routes/service.ts', import.meta.url), 'utf8')
const conversationListStart = crmRoute.indexOf("app.get('/crm/conversations'")
const conversationSummaryStart = crmRoute.indexOf("app.get('/crm/conversations/summary'", conversationListStart)
const conversationListRoute = crmRoute.slice(conversationListStart, conversationSummaryStart)
const latestDepositStart = crmRoute.indexOf('async function conversationWithLatestDeposit')
const automatedMessageStart = crmRoute.indexOf('async function sendCrmAutomatedMessage', latestDepositStart)
const latestDepositHelper = crmRoute.slice(latestDepositStart, automatedMessageStart)
const conversationDepositSelectStart = crmRoute.indexOf('const conversationDepositSelect')
const depositAppointmentSelectStart = crmRoute.indexOf('const crmDepositAppointmentSelect')
const depositAppointmentSelectEnd = crmRoute.indexOf('\n\nfunction conversationStepForPersistedBookingState', depositAppointmentSelectStart)
const conversationDepositSelect = crmRoute.slice(conversationDepositSelectStart, depositAppointmentSelectStart)
const depositAppointmentSelect = crmRoute.slice(depositAppointmentSelectStart, depositAppointmentSelectEnd)

assert.ok(conversationListStart >= 0, 'debe existir el listado de conversaciones')
assert.ok(conversationSummaryStart > conversationListStart, 'debe poder aislarse la ruta del listado')
assert.ok(
  conversationListRoute.includes('select: conversationDepositSelect'),
  'el listado debe devolver sólo el resumen de la seña y no el comprobante binario'
)
assert.ok(conversationDepositSelectStart >= 0, 'debe existir una selección compacta de señas')
assert.equal(
  conversationDepositSelect.includes('proofData'),
  false,
  'el resumen de seña no debe transferir el archivo del comprobante'
)
assert.ok(depositAppointmentSelectStart >= 0, 'debe existir una selección compacta de turnos con seña')
assert.equal(
  depositAppointmentSelect.includes('imageUrl') || depositAppointmentSelect.includes('avatarUrl'),
  false,
  'la revisión de señas no debe transferir imágenes de servicios o profesionales'
)
assert.ok(
  conversationListRoute.includes('latestMessagesByConversationId('),
  'el listado debe cargar los últimos mensajes con la consulta acotada'
)
assertNoMessageRelations(conversationListRoute, 1)

assert.ok(
  crmRoute.includes('SELECT DISTINCT ON ("conversationId") "Message".*'),
  'la consulta debe devolver como máximo un mensaje por conversación'
)
assert.ok(
  crmRoute.includes('ORDER BY "conversationId", "createdAt" DESC, "id" DESC'),
  'la selección del último mensaje debe ser determinística'
)
assert.ok(
  latestDepositHelper.includes('prisma.message.findFirst({'),
  'la actualización de una conversación debe consultar el último mensaje con LIMIT en la consulta principal'
)
assertNoMessageRelations(latestDepositHelper, 2)

assertAuthMediaOmitted(authRoute)

assert.ok(
  serviceRoute.includes("includeImages?: string") && serviceRoute.includes("omit: { imageUrl: true }"),
  'el catálogo de servicios debe permitir excluir imágenes desde la consulta SQL'
)
assert.ok(
  professionalRoute.includes("includeImages?: string") &&
    professionalRoute.includes("omit: { avatarUrl: true }") &&
    professionalRoute.includes("professionalIncludeWithoutImages"),
  'el catálogo de profesionales debe excluir avatares e imágenes de servicios en modo liviano'
)
assert.ok(
  crmUiRoute.includes("await getJson('/professionals' + lightweightCatalogQuery)") &&
    crmUiRoute.includes("await getJson('/services' + lightweightCatalogQuery)"),
  'la carga inicial del CRM debe usar los catálogos livianos'
)
assert.ok(
  crmUiRoute.includes('async function ensureProfessionalMedia()') &&
    crmUiRoute.includes('async function ensureServiceMedia()') &&
    crmUiRoute.includes('async function ensureBusinessMedia()'),
  'las imágenes deben cargarse bajo demanda por sección'
)
assert.ok(
  crmUiRoute.includes('state.professionalMediaBusinessId === businessId') &&
    crmUiRoute.includes('state.serviceMediaBusinessId === businessId') &&
    crmUiRoute.includes('state.businessMediaBusinessId === businessId'),
  'la carga bajo demanda debe conservar una caché por local mientras el CRM permanece abierto'
)
assert.ok(
  businessRoute.includes("app.get('/businesses/:id/media'") &&
    businessRoute.includes('landingGalleryImages: true'),
  'los medios del local deben tener una consulta puntual protegida por permisos'
)

console.log('CRM egress contract tests passed')
