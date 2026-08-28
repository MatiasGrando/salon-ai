# Runbook de seguridad y privacidad de señas (F8.1)

**Estado del documento:** **F8.1 aprobada: no hay cron de purga activado.** La implementación y
los contratos F8 están completos y verificados en el snapshot local aislado; esto no constituye
activación productiva. La ingesta productiva de proofs, la activación del sender y la programación
de purge permanecen **OFF**. El ledger formal está documentado y verificado localmente en
`prisma-f8-baseline-runbook.md`; toda activación operativa sigue fuera de este documento.
Se basa en
`docs/nuevo-bot/plan-implementacion.md` (F8.1), `diseno-tecnico.md` (§8, §14, §18),
`reglas-funcionales.md` (§13) y el código actual en
`src/services/booking-deposit-service.ts`, `src/routes/crm.ts`,
`src/services/tenant-resource-authorization.ts`, `src/routes/business.ts` y
`prisma/schema.prisma`.

**Objetivo:** definir y aplicar los controles de acceso, retención, purga, backups, auditoría
y tratamiento de datos de los comprobantes de seña. Por la Definition of Done de F8.1, la
ingestión de proofs **permanece deshabilitada para producción hasta verificar estos controles**.

---

## 1. Clasificación de PII de los comprobantes

Un comprobante es una imagen (JPEG/PNG/WebP) o PDF de un recibo de transferencia. Puede contener:

- Nombre y apellido del titular y del cliente.
- Alias, CBU/CVU, banco y monto.
- Fecha/hora de la operación.

**Clasificación:** PII sensible / datos financieros. Jerarquía superior al nombre o teléfono
habituales del cliente. El cuerpo del comprobante puede además incluir datos de terceros (quien
efectuó la transferencia).

**Principio:** minimización. El comprobante se almacena sólo para revisión y trazabilidad
financiera; no se usa en métricas, logs ni mensajería.

---

## 2. Evidencia append-only: objetivo y brecha actual

**Slice F8.4/F8.5 implementado, sin activación productiva:** las migraciones
`20260827130000_add_f8_append_only_deposit_proofs` y
`20260827140000_add_f8_proof_writer_guards` definen `BookingDepositProof` append-only por
tenant+depósito. Cada intento `INITIAL` / `RESUBMISSION` / `LATE` lleva secuencia contigua,
original y derivado WebP, SHA-256/tamaño/MIME, filename saneado, IDs provider opcionales,
versión/fecha de validación y `retentionEligibleAt`. IDs provider y hash fuente deduplican sólo
dentro del agregado tenant-scoped. `UPDATE` y `DELETE` se rechazan mientras exista el depósito;
un constraint diferido deja posible un futuro purge autorizado del agregado completo.
`writeValidatedDepositProof` recibe exclusivamente evidencia ya validada: en una única TX toma
los locks F7, inserta la evidencia y operación `BotOperation`, y antes del deadline mueve el
agregado F8 a revisión; después del deadline sólo agrega `LATE`. No hay `currentProofId`: el
writer no muta blobs legacy ni expone la selección de evidencia a CRM. Los contratos PG se
verifican exclusivamente contra el snapshot local autorizado; no se habilitó ingress, runtime ni
sender en producción.

**Compatibilidad legacy (`prisma/schema.prisma`, modelo `BookingDeposit`):**

- Los bytes se guardan **en línea** en `bookingDeposit.proofData Bytes?`, junto con
  `proofMimeType` y `proofFilename`.
- Un nuevo envío (ruta WEB) **sobrescribe** esas columnas (`submitWebProof`,
  `booking-deposit-service.ts` líns. 124-137). No existe historial de intentos.
- El flujo legacy no lee `BookingDepositProof`; conserva sus blobs y estados históricos sin
  mezclarlos con el agregado F8 append-only.

**Brecha vigente hasta aplicar y cablear el slice:** la evidencia legacy no es append-only. Un
reenvío o rechazo reemplaza los bytes previos, se pierde la traza forense de qué comprobante se
revisó/aprobó y no hay hash de integridad ni registro por intento del resultado de validación.

---

## 3. Política final de acceso CRM (gate F8.1)

- **Aislamiento por negocio:** `tenant-resource-authorization.ts`
  `authorizedBookingDepositWhere(user, id)` filtra por la relación `business`.
  `loadAuthorizedBookingDeposit` devuelve `null` ante un depósito de otro tenant, y las rutas
  responden `404 notFound` (`sendAuthorizationFailure`) — no revelan la existencia del recurso.
- **Revisor autorizado:** un `STAFF` requiere `canManageDeposits === true` para la bandeja,
  descarga (`GET /crm/deposits*`) y las cuatro rutas legacy de aprobar/rechazar por depósito o
  conversación. `BUSINESS_ADMIN` y `SUPER_ADMIN` conservan su autoridad administrativa
  existente; `ACCOUNT_ADMIN` no accede al CRM operativo. La capacidad no se sustituye por
  `canViewConversations`.
- **Aislamiento por negocio:** cada recurso puntual continúa cargándose con
  `authorizedBookingDepositWhere`/`loadAuthorizedBookingDeposit`; un ID de otro tenant sigue
  devolviendo 404 sin revelar existencia.
- **Descarga de bytes:** sólo `source === 'WEB'` con `proofData`; fija `Cache-Control: private,
  no-store`. No se agregaron URLs firmadas ni acceso de object storage.
- **Revisión legacy:** las mutaciones persisten `reviewedAt` y `reviewedByUserId`. Para STAFF,
  las revisiones mutantes exitosas también pasan por `StaffAuditLog` del guard global.
- **Configuración de medios de pago:** `PATCH /businesses/:id/payment-settings`
  (`business.ts` líns. 97-104) prohíbe rol `STAFF` (403); la lectura está permitida.
- **Límite conocido:** aún no existe evento append-only específico de revisión ni auditoría de
  descargas. Antes de ingesta productiva, F8.5 debe registrar recepción, validación, descarga,
  revisión y purge por `proofId`, actor, tenant y timestamp. Nunca registrar bytes, nombre de
  archivo ni hash en logs de aplicación.

---

## 4. Sin contenido de comprobante en logs, métricas ni outbox

- **Logs:** las funciones de servicio no escriben `proofData`. Los `request.log.error` en CRM
  usan `appointmentId`/`error`, nunca bytes del comprobante.
- **Métricas (diseño §13/§14):** segmentación por negocio y versión de motor; sin teléfono,
  nombre, cuerpo ni IDs de entidad en labels. No debe haber PII en series de métricas.
- **Outbox / mensajería:** el contenido del comprobante no se coloca en `Message` ni en el
  payload del outbox; sólo se envía un texto de ACK.
- **Verificación continua:** mantener como control de revisión que ningún nuevo log/metric/outbox
  incluya `proofData`, `proofFilename` o el cuerpo del recibo.

---

## 5. Descarga y validación segura de media

- **Compatibilidad legacy:** `submitWebProof` (invocado desde `public-booking.ts`) decodifica un
  data URL y valida. El flujo F8 incorpora el adaptador
  `meta-deposit-proof-media.ts`: descarga fuera de la TX, restringe HTTPS allowlisted, tamaño y
  MIME, y entrega bytes al validador/writer. Está cubierto por contratos, pero la ingesta de
  proofs y el runtime productivo permanecen **OFF**.
- **Límites (diseño §14):** la descarga debe ocurrir fuera de la transacción, sólo tras validar
  tenant y estado esperado, con tope de 3 MiB antes y después de descargar.
- **Gate operativo:** no se deben habilitar rutas legacy para revisar proofs F8. La revisión F8,
  sus notificaciones y recuperación están implementadas y contratadas, pero siguen sin
  activación productiva de ingress ni sender.

---

## 6. Controles MIME / magic / tamaño

Implementado hoy en `parseWebProof` / `matchesProofSignature` (`booking-deposit-service.ts`):

- **Allowlist legacy actual:** `image/jpeg`, `image/png`, `image/webp`.
- **Tamaño:** tope duro de 3 MiB (`WEB_PROOF_MAX_BYTES`).
- **Magic bytes** (no se confía en extensión ni MIME declarado):
  - JPEG: `FF D8 FF`
  - PNG: `89 50 4E 47 0D 0A 1A 0A`
  - WebP: `RIFF....WEBP`
- **PDF:** rechazado explícitamente y diferido. No se acepta por MIME ni por magic bytes hasta
  que F8.4 aporte parser mantenido, política de contenido activo/cifrado y entrega segura.

**Slice F8.4 implementado:** `deposit-proof-image-validation.ts` usa `sharp` (dependencia
mantenida ya instalada) para exigir magic+MIME coherentes, decode completo limitado a 40 Mpx y
re-encode WebP sin metadata. Limita tanto original como derivado a 3 MiB, calcula SHA-256 de ambos
y sanea el filename sin emitir logs. PDF no es una excepción: permanece rechazado/diferido. El
validador forma parte del flujo F8 contratado, sin habilitar ingress ni sender productivos.

---

## 7. Escaneo de malware / cuarentena (placeholder)

- **Estado actual:** no hay antivirus externo, sandbox ni tabla de cuarentena. El agregado F8
  conserva el resultado de validación; PDF continúa rechazado, no almacenado en cuarentena.
- **Decisión operativa:** F8 rechaza PDF antes de persistirlo; no implementa cuarentena parcial,
  render server-side ni AV externo. La política de PDF cifrado/activo queda diferida hasta que
  exista una solución de cuarentena mantenida y aprobada.

---

## 8. Retención y borrado: arquitectura segura, sin activación destructiva

- **Política aprobada (decisión 6 / decisión 18):** conservar los bytes del comprobante mientras la
  reserva esté activa y purgarlos **12 meses después de la fecha del turno** (o 12 meses desde
  la recepción para rechazados/tardíos). El purge elimina **sólo los bytes**; permanecen
  `sha256`, estado, timestamps y auditoría como trazabilidad financiera. Los backups previos
  retienen copias hasta su rotación natural.
- **Legal hold:** **explícitamente ausente en etapa 1** (decisión 18: "sin legal hold en etapa
  1"). Cualquier requisito de retención por litigio/regulatorio es una **brecha**: debe
  implementarse antes de tratar datos sujetos a hold, o no habilitar depósitos para esos casos.
- **Purge byte-only F8 (pendiente de aplicar):**
  `20260827170000_add_f8_proof_byte_retention_purge` vuelve nullable únicamente
  `sourceData`/`derivedData` y agrega `purgedAt`, razón fija `RETENTION_12_MONTHS`, operación y
  audit append-only sin PII. El trigger permite exclusivamente la transición una vez
  `bytes presentes → ambos NULL`, con `retentionEligibleAt <= clock_timestamp()` de PostgreSQL;
  preserva hashes, MIME, tamaños, filename, validación, secuencia y timestamps, fija `purgedAt`
  en DB y rechaza toda otra actualización, incluido restaurar bytes. No hay legal hold en etapa 1.
  `purgeDueDepositProofBytes` usa batches 1..1000, dry-run, scope global o tenant, operación
  idempotente y `FOR UPDATE SKIP LOCKED`; la mutación, evento y operación completan/rollback en
  una única TX. No usar `deleteMany` ni SQL directo fuera de la primitiva.
- **CLI local, no scheduler:** `npm run maintenance:purge-proof-bytes --
  --database-url=<URL-local> --allow-local-database=true` hace sólo dry-run. Para ejecutar exige
  además `--execute=true --confirm=PURGE_PROOF_BYTES --operation-key=<clave-no-PII>`. Rechaza todo
  host no local. Esta salvaguarda NO autoriza producción ni activa cron.
- **Gate de activación:** primero migración append-only, dry-run con conteo por tenant, backup y
  restore drill, prueba de recuperación/idempotencia y aprobación operativa. Recién entonces un
  worker cercado con lease/fencing y métrica/alerta. **F8.1 aprobada: no hay cron de purga
  activado.** El `proofData` legacy se conserva; no se ejecutó ninguna escritura destructiva.

---

## 9. Almacenamiento cifrado / backups / acceso a claves

- **Almacenamiento:** `proofData` vive en una columna `Bytes` de Postgres. **No hay
  encriptación a nivel aplicación** en el código; depende de la encriptación en reposo del
  volumen/DB del despliegue.
- **Backups (decisión 6, infra):** diarios, retención 30 d, **RPO ≤ 24 h**, **RTO ≤ 4 h**,
  con drill de restore obligatorio antes del piloto. Debe verificarse que el backup incluye la
  tabla de comprobantes y que los drills cubren PII.
- **Claves:** el `appSecret` de WhatsApp es por negocio (decisión D) y no es de los comprobantes;
  el acceso a los bytes de proof está regido sólo por la autenticación CRM. No hay claves de
  encriptación de campo para proofs en el código.

---

## 10. Pista de auditoría

- **Existente:** `BookingDeposit.reviewedAt` y `reviewedByUserId` se fijan en aprobar/rechazar
  (`crm.ts` líns. 1103, 1211).
- **Brechas:**
  - No hay registro de **quién descargó** un comprobante.
  - Sin tabla append-only, no hay auditoría por intento de recepción/validación.
  - No existe un evento de auditoría consultable y separado de la fila para "depósito revisado
    por X en Y" (sólo los campos en la propia fila).
  - Esto limita el alcance de cualquier incidente de filtración (ver §12).

---

## 11. Respuesta ante incidentes

Pasos operativos ante sospecha de exposición de un comprobante:

1. Acotar alcance: IDs de `bookingDeposit` afectados y `businessId`.
2. Si el acceso fue por usuario CRM indebido, revocar/suspender la sesión y revisar su
   actividad.
3. Verificar que el aislamiento por tenant se mantuvo (cross-tenant devuelve 404, no datos).
4. Revisar backups por posible exposición y aplicar retención/borrado según §8.
5. Notificar al responsable de privacidad/DPO; los comprobantes son recibos y no se "rotan",
   pero sí se debe advertir al cliente afectado.
6. **Limitación actual:** sin auditoría de descargas (§10), el paso 1 es aproximado.

---

## 12. Autoridad de aprobación / rechazo

- **Aprobar:** `POST /crm/deposits/:id/approve` — sólo `source === 'WEB'` y estado
  `PROOF_RECEIVED` → `APPROVED`; fija `reviewedAt`/`reviewedByUserId` y confirma los turnos
  coordinados atómicamente bajo el lock de jerarquía de agenda.
- **Rechazar:** `POST /crm/deposits/:id/reject` — exige `reason` (≤300), estado → `REJECTED`
  (legacy) y cancela turnos `PENDING`.
- **A nivel conversación:** también existen
  `/crm/conversations/:id/deposit/approve|reject` con la misma guarda `source === 'WEB'`.
- **Autoridad:** un STAFF sólo puede revisar con `canManageDeposits`; los administradores
  mantienen la autoridad inherente de su rol. Doble click mitigado por chequeo de estado bajo
  transacción. La presente fase no agrega operaciones CRM ni notificaciones: las rutas legacy y
  sus side effects preexistentes no son el contrato del nuevo flujo F8.
- **F8 separado de legacy:** el agregado F8 modela revisión, reenvío y rechazo final con sus
  operaciones idempotentes. Las rutas legacy continúan limitadas a `source === 'WEB'`; no se
  usan para habilitar ni revisar proofs F8 en producción.

---

## 13. Comportamiento de vencimiento y comprobante tardío

- **Vencimiento:** `bookingDepositService.expireOverdue()` pasa `PENDING_PROOF` → `EXPIRED` y
  cancela turnos `PENDING`, bajo el lock de jerarquía de agenda.
- **F8.6:** existe un worker cercado para `EXPIRE_DEPOSIT`, con recuperación y fencing; su
  programación/runtime productivo permanece **OFF**. El expirador legacy continúa perezoso y no
  gobierna agregados F8.
- **Comprobante tardío F8:** inserta exclusivamente una evidencia `LATE` append-only y nunca
  reabre el hold. La ruta legacy conserva su comportamiento histórico, incluido `409` para WEB.
- **Política F8.1:** un comprobante tardío se deriva a atención humana y **nunca reabre** la
  retención ni confirma/cancela nuevamente el turno. No se agregó mensaje, notificación ni
  wiring de runtime en esta fase; el handoff legacy existente permanece como comportamiento de
  contención hasta que el flujo F8 tenga su propio contrato.

---

## 14. Listas de chequeo operativas

### 14.1 Puerta de habilitación (debe cumplirse antes de producción)

- [x] Agregado `BookingDepositProof` append-only con hashes, validación y secuencia; verificado
      en el snapshot local aislado. No requiere `currentProofId` mutable.
- [x] Purge byte-only diseñado en migración y primitiva: hash/estado/auditoría sobreviven; dry-run,
       idempotencia, rollback y carrera están cubiertos por contratos PG aislados. Pendiente
       aplicar y validar en un entorno operativo aprobado.
- [ ] Decisión y mecanismo de **legal hold** o exclusión explícita de casos sujetos a hold (§8).
- [x] Descarga y validación F8 de media WhatsApp con MIME+magic+tamaño fuera de TX (§5/§6), sin
      activación productiva.
- [x] Decode/re-encode de imágenes y rechazo de PDF; la cuarentena/AV de PDF sigue diferida (§7).
- [ ] Habilitación operativa del worker de expiración; no activar cron sin aprobación (§13).
- [ ] Auditoría de descargas y evento de revisión consultable (§10).
- [x] Política de autoridad mínima: `canManageDeposits` para STAFF y alcance por tenant (§3/§12).
- [ ] Drill de restore de backup que cubra la tabla de comprobantes y PII (§9).
- [ ] Verificación de que logs/métricas/outbox no contienen contenido de proof (§4).

### 14.2 Operación diaria / semanal

- [ ] Revisar backlog de `PENDING_PROOF` y `EXPIRED`; confirmar que el vencimiento eventualmente
      se ejecuta (hoy depende de eventos perezosos).
- [ ] Verificar que no hay accesos cross-tenant (los 404 deben ser la norma ante IDs ajenos).
- [ ] Control de acceso CRM: revisar altas/bajas de usuarios con permiso de revisión.
- [ ] Confirmar que el backup diario incluye la tabla de proofs y que RPO/RTO son los acordados.

### 14.3 Onboarding de un negocio para señas

- [ ] `BusinessPaymentSettings` completo (alias o CBU/CVU + titular; banco/instrucciones
      opcionales) — `business.ts` líns. 83-169.
- [ ] Timezone IANA configurada (preflight de activación lo exige).
- [ ] Retención y política de malware aprobadas por el responsable.

---

## 15. Brechas de implementación que bloquean habilitar depósitos

| # | Brecha | Dónde | Impacto |
|---|---|---|---|
| G1 | Ingesta F8 y sender siguen desactivados en producción | gates de runtime | No habilitar proofs sin aprobación operativa |
| G2 | Las rutas CRM legacy exigen `source === 'WEB'` | `crm.ts` | No usarlas para proofs F8 |
| G3 | El flujo WEB legacy sobrescribe `proofData` | `submitWebProof` | No mezclarlo con evidencia F8 append-only |
| G4 | El baseline formal está verificado; falta rollout específico para cualquier ambiente con ledger histórico | migrations F8 | No ejecutar el squash en un ledger histórico sin transición probada |
| G5 | Purge byte-only no tiene scheduler habilitado | primitiva y contratos PG | No activar cron ni producción |
| G6 | Sin legal hold | decisión 18 | Riesgo legal si aplica retención forzada |
| G7 | Sin cuarentena/AV para PDF cifrado o activo | política F8 | PDF se rechaza, no se almacena |
| G8 | Worker de expiración no está activado | gate de runtime | No habilitar producción |
| G9 | No usar los estados legacy como sustituto de la revisión F8 | CRM legacy | Evitar mezclar agregados |
| G10 | Sin auditoría de descargas ni evento de revisión separado | `reviewedByUserId` sólo en fila | Alcance de incidente limitado |
| G11 | Sin auditoría append-only de descargas/revisiones por proof | esquema/CRM | Alcance de incidente limitado |

**Conclusión:** los contratos F8 cubren el flujo de depósito aislado, pero la ingesta, sender y
schedulers productivos permanecen OFF. Para habilitarlos deben cerrarse G1, G4, G5, G6, G7, G8 y
G10, con aprobación operativa explícita.
