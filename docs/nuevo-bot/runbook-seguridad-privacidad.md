# Runbook de seguridad y privacidad de señas (F8.1)

**Estado del documento:** documentación operativa. No modifica código, esquema, migraciones,
scripts, tests ni configuración. Trabajo puramente descriptivo a partir de
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

**Objetivo (diseño §8, F1.6/F8.5):** tabla `BookingDepositProof` append-only donde cada
intento (INITIAL / RESUBMISSION / LATE) es inmutable y conserva `sha256`, `mimeType`, `size`,
`filename`, `validationStatus`, `receivedAt` y `createdBy`; `BookingDeposit.currentProofId`
apunta a la evidencia vigente sin sobrescribir intentos anteriores.

**Estado actual (`prisma/schema.prisma`, modelo `BookingDeposit`):**

- Los bytes se guardan **en línea** en `bookingDeposit.proofData Bytes?`, junto con
  `proofMimeType` y `proofFilename`.
- Un nuevo envío (ruta WEB) **sobrescribe** esas columnas (`submitWebProof`,
  `booking-deposit-service.ts` líns. 124-137). No existe historial de intentos.
- No existen: `BookingDepositProof`, `currentProofId`, `version`, `sha256`,
  `validationStatus`, ni los estados `REJECTED_RESUBMISSION_ALLOWED` / `REJECTED_FINAL`.

**Brecha:** la evidencia no es append-only. Un reenvío o rechazo reemplaza los bytes previos,
se pierde la traza forense de qué comprobante se revisó/aprobó y no hay hash de integridad ni
registro por intento del resultado de validación.

---

## 3. Acceso CRM con mínimo privilegio y por tenant

- **Aislamiento por negocio:** `tenant-resource-authorization.ts`
  `authorizedBookingDepositWhere(user, id)` filtra por la relación `business`.
  `loadAuthorizedBookingDeposit` devuelve `null` ante un depósito de otro tenant, y las rutas
  responden `404 notFound` (`sendAuthorizationFailure`) — no revelan la existencia del recurso.
- **Descarga de bytes:** `GET /crm/deposits/:id/proof` (`crm.ts` líns. 1024-1052) es
  tenant-scoped y sólo sirve cuando `source === 'WEB'` y existe `proofData`; fija
  `Cache-Control: private, no-store`.
- **Aprobación/rechazo:** `POST /crm/deposits/:id/approve` y `/reject` (`crm.ts` 1054-1234)
  usan `loadAuthorizedBookingDeposit` + guarda `source === 'WEB'`, y registran
  `reviewedByUserId`.
- **Configuración de medios de pago:** `PATCH /businesses/:id/payment-settings`
  (`business.ts` líns. 97-104) prohíbe rol `STAFF` (403); la lectura está permitida.
- **Brecha / riesgo:** la revisión de depósitos (approve/reject) hoy la puede ejecutar
  cualquier usuario autenticado del negocio (dueño y `STAFF`); no hay un rol específico de
  "revisor de señas" separado de la exclusión de `STAFF` sobre payment-settings. El runbook
  debe fijar una política de autoridad explícita antes de habilitar depósitos.

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

- **Sólo el origen WEB ingesta bytes hoy:** `submitWebProof` (invocado desde
  `public-booking.ts`) decodifica un data URL y valida. El camino de WhatsApp
  (`markProofReceived` / `registerLateProofIfExpired`) guarda **solo** `proofMessageId`;
  **nunca descarga ni valida los bytes** del media de WhatsApp. El adaptador `meta-media.ts`
  (F8.4) **no está implementado**.
- **Límites (diseño §14):** la descarga debe ocurrir fuera de la transacción, sólo tras validar
  tenant y estado esperado, con tope de 3 MiB antes y después de descargar.
- **Brecha crítica:** por WhatsApp no hay descarga ni validación de contenido; la "evidencia"
  es sólo una referencia de mensaje. Las rutas de aprobación/rechazo exigen `source === 'WEB'`,
  por lo que un depósito por WhatsApp **no puede aprobarse ni rechazarse en CRM**. El flujo de
  señas del nuevo bot (WhatsApp) no es funcional de punta a punta en el código actual.

---

## 6. Controles MIME / magic / tamaño

Implementado hoy en `parseWebProof` / `matchesProofSignature` (`booking-deposit-service.ts`):

- **Allowlist MIME:** `image/jpeg`, `image/png`, `image/webp`, `application/pdf`.
- **Tamaño:** tope duro de 3 MiB (`WEB_PROOF_MAX_BYTES`).
- **Magic bytes** (no se confía en extensión ni MIME declarado):
  - JPEG: `FF D8 FF`
  - PNG: `89 50 4E 47 0D 0A 1A 0A`
  - WebP: `RIFF....WEBP`
  - PDF: `%PDF-`

**Brecha:** no hay decode/re-encode de imágenes (el diseño §14 exige re-codificar y registrar
hash del original y del derivado), ni parseo estructural de PDF, ni rechazo/cuarentena de PDF
cifrado/con contenido activo. El chequeo magic es parcial.

---

## 7. Escaneo de malware / cuarentena (placeholder)

- **Estado actual:** ninguno. No hay antivirus externo, sandbox, tabla de cuarentena ni
  `validationStatus` en el modelo.
- **Diseño (decisión 18):** etapa 1 acepta el riesgo residual sin AV externo, pero exige
  cuarentena de PDF cifrado/adjuntos/JavaScript/formularios y entrega sólo como adjunto sin
  render server-side. Ese comportamiento **no está implementado**: un PDF cifrado pasa el
  prefijo `%PDF-` y se almacena.
- **Placeholder operativo:** hasta implementar `validationStatus VALID|INVALID|QUARANTINED`,
  tratar como `INVALID` (rechazar) cualquier contenido que falle validación estructural; para
  PDF, aceptar el riesgo o diferir la habilitación. Registrar como brecha.

---

## 8. Retención y borrado (con salvedad de legal hold)

- **Objetivo (decisión 6 / decisión 18):** conservar los bytes del comprobante mientras la
  reserva esté activa y purgarlos **12 meses después de la fecha del turno** (o 12 meses desde
  la recepción para rechazados/tardíos). El purge elimina **sólo los bytes**; permanecen
  `sha256`, estado, timestamps y auditoría como trazabilidad financiera. Los backups previos
  retienen copias hasta su rotación natural.
- **Legal hold:** **explícitamente ausente en etapa 1** (decisión 18: "sin legal hold en etapa
  1"). Cualquier requisito de retención por litigio/regulatorio es una **brecha**: debe
  implementarse antes de tratar datos sujetos a hold, o no habilitar depósitos para esos casos.
- **Estado actual:** no existe job de purga; `proofData Bytes` se retiene indefinidamente en DB.
  La eliminación masiva de `bookingDeposit` en mantenimiento QA (`crm.ts` ~líns. 391-402)
  borra evidencias y debe revisarse contra la política de retención.

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
- **Autoridad:** hoy cualquier usuario autenticado del negocio (incl. `STAFF`) puede
  aprobar/rechazar; no hay rol de revisor separado. Doble click mitigado por chequeo de estado
  bajo transacción.
- **Brechas:** distinción `REJECTED_RESUBMISSION_ALLOWED` vs `REJECTED_FINAL` y el nuevo TTL de
  reenvío (diseño F8.7/F8.8) **no implementados**; el rechazo usa el estado legacy `REJECTED`.
  Los depósitos por WhatsApp no son aprobables/rechazables en CRM (ver §5).

---

## 13. Comportamiento de vencimiento y comprobante tardío

- **Vencimiento:** `bookingDepositService.expireOverdue()` pasa `PENDING_PROOF` → `EXPIRED` y
  cancela turnos `PENDING`, bajo el lock de jerarquía de agenda.
- **Brecha crítica de programación:** `expireOverdue` **sólo se invoca de forma perezosa**
  (antes de submit/approve/reject/list/booking en `crm.ts`, `appointment-service.ts`,
  `conversation-service.ts`, `public-booking.ts`). **No hay un worker/cron dedicado** que
  expire depósitos; uno puede quedar `PENDING_PROOF` indefinidamente hasta un evento relacionado.
  El diseño F8.6 exige expiración programada.
- **Comprobante tardío:** `registerLateProofIfExpired` (camino WhatsApp) fija `proofMessageId` y
  `rejectionReason` en un depósito ya `EXPIRED`, pero **no crea una fila de proof aparte**, no es
  append-only y no recupera el hold. Para WEB, un envío tardío devuelve `409`. El tipo
  `LATE` append-only del diseño **no está implementado**.

---

## 14. Listas de chequeo operativas

### 14.1 Puerta de habilitación (debe cumplirse antes de producción)

- [ ] Tabla `BookingDepositProof` append-only con `sha256`, `validationStatus`, secuencia y
      `currentProofId` (cierra §2).
- [ ] Job de purga de bytes a 12 meses que conserve hash/estado/auditoría (§8).
- [ ] Decisión y mecanismo de **legal hold** o exclusión explícita de casos sujetos a hold (§8).
- [ ] Descarga y validación de media WhatsApp (`meta-media.ts`) con MIME+magic+tamaño fuera de
      TX (§5/§6).
- [ ] Decode/re-encode de imágenes y parseo estructural + cuarentena de PDF; `validationStatus`
      QUARANTINED implementado (§7).
- [ ] Worker/cron de expiración programada, no sólo perezosa (§13).
- [ ] Auditoría de descargas y evento de revisión consultable (§10).
- [ ] Rol de revisor de señas / política de autoridad mínima (§3/§12).
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
| G1 | Ingesta de proof sólo para origen `WEB`; WhatsApp no descarga ni valida bytes | `booking-deposit-service.ts`, `meta-media.ts` ausente | Depósitos del nuevo bot (WhatsApp) sin evidencia real |
| G2 | Aprobar/rechazar en CRM exige `source === 'WEB'` | `crm.ts` 1059, 1176, 1607, 1784 | Depósito WhatsApp no es revisable en CRM |
| G3 | Evidencia no append-only; se sobrescribe `proofData` | `schema.prisma` `BookingDeposit`, `submitWebProof` | Pérdida de traza forense e integridad |
| G4 | Sin `BookingDepositProof`, `currentProofId`, `sha256`, `validationStatus` | esquema | Sin hash ni estado de validación por intento |
| G5 | Sin job de purga de bytes (retención 12 meses) | — | Retención indefinida en DB |
| G6 | Sin legal hold | decisión 18 | Riesgo legal si aplica retención forzada |
| G7 | Sin decode/re-encode ni cuarentena PDF/cifrado | `matchesProofSignature` parcial | PDFs cifrados/activos se almacenan |
| G8 | Expiración sólo perezosa, sin cron/worker | llamados a `expireOverdue` | Depósitos pueden quedar `PENDING_PROOF` indefinidamente |
| G9 | Sin distinción `REJECTED_RESUBMISSION_ALLOWED` / `REJECTED_FINAL` ni TTL de reenvío | enum `BookingDepositStatus` | Rechazo corregible/final no modelado |
| G10 | Sin auditoría de descargas ni evento de revisión separado | `reviewedByUserId` sólo en fila | Alcance de incidente limitado |
| G11 | Sin rol de revisor específico (STAFF puede aprobar/rechazar) | `crm.ts` auth | Privilegio más amplio del necesario |

**Conclusión:** el código actual soporta señas únicamente por el canal WEB con validación parcial.
Para habilitar depósitos del nuevo bot por WhatsApp en producción, deben cerrarse al menos G1,
G2, G3, G5, G8 y la decisión de legal hold (G6), además de los controles de malware (G7) y
auditoría (G10) descritos en el diseño.
