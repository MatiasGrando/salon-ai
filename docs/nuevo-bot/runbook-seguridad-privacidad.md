# Runbook de seguridad y privacidad de señas (F8.1)

**Estado: Aprobación operativa pendiente.** Actualizado el 09/10/2026 mediante
inspección del repositorio. Describe controles implementados y verificaciones
operativas pendientes; no certifica infraestructura, despliegues ni producción.
Este documento no activa capacidades, workers, purgas ni cambia permisos.

## 1. Alcance y clasificación

Los comprobantes pueden contener nombres, alias, CBU/CVU, banco, monto y datos
de terceros: tratarlos como PII sensible financiera. Acceso mínimo por tenant;
no incorporar bytes, nombres de archivos, hashes ni datos bancarios a logs,
métricas o mensajes. Los avisos al cliente comunican el estado, no el recibo.

Hay dos recorridos distintos, que no deben confundirse:

- **F8:** depósitos con `visitId`, vinculados a visita/turno y snapshot financiero.
  Evidencia independiente en `BookingDepositProof` y operaciones auditadas.
- **Legacy:** depósitos con `visitId: null`; `booking-deposit-service.ts` mantiene
  sus columnas `proofData`, `proofMimeType` y `proofFilename`. El envío WEB puede
  reemplazarlas. No atribuirle las garantías append-only del recorrido F8.

## 2. Acceso, descarga y revisión

- `staff-permission-service.ts` exige `canManageDeposits` para listar señas,
  descargar comprobantes y aprobar/rechazar, también desde conversaciones.
  Ver conversaciones o responder mensajes no concede ese permiso.
- Las rutas CRM usan autorización por negocio; un recurso de otro tenant no
  debe revelar su existencia. Mantener autenticación y filtros de autorización.
- En F8, `GET /crm/deposits/:id/proof` obtiene el derivado de la última evidencia
  válida, registra `DOWNLOAD_DEPOSIT_PROOF` en `staffAuditLog` y entrega como
  adjunto con `Cache-Control: private, no-store`.
- La rama legacy sirve sus bytes sólo si es origen WEB, también con no-store;
  no asumir que tiene la auditoría de descarga ni el saneamiento de F8.
- Aprobación/rechazo F8 pasan por `deposit-review-operation.ts`, con clave de
  operación, tenant, estado elegible, locks y `BookingDepositReviewAudit`.
  El rechazo distingue modo `RESUBMISSION_ALLOWED` de `FINAL`; el estado para
  reenvío es `PENDING_RESUBMISSION`. No inventar otros estados de base.
- Los grupos coordinados se revisan completos, no segmento a segmento. El
  comprobante recibido no confirma la reserva: falta aprobación real del pago.
- Configurar medios de pago sigue siendo una autoridad distinta. No cambiar
  sus permisos para solucionar una revisión de comprobantes.

## 3. Ingreso y validación técnica de comprobantes

Fuentes: `src/bot-options/application/process-deposit-proof-job.ts`,
`src/bot-options/infrastructure/meta-deposit-proof-media.ts` y
`src/services/deposit-proof-image-validation.ts`.

- El ingreso F8 conserva la guarda explícita `capabilityEnabled` y el fence del
  trabajo. Resuelve tenant, depósito elegible y origen antes de persistir.
- Descarga Meta fuera de la transacción, con timeout, destinos HTTPS permitidos
  y límite de bytes declarado y leído. No mantener locks durante la descarga.
- JPEG, PNG y WebP, máximo **3 MiB**; MIME declarado y firma deben concordar.
  Sharp decodifica, limita píxeles, rechaza múltiples páginas y genera WebP
  saneado sin metadatos; se conservan hashes del original y del derivado.
- El wrapper `deposit-proof-validation.ts` conserva la validación de imágenes y
  admite **PDF clásico** hasta 3 MiB y 10 páginas. PDF cifrado, contenido activo,
  acciones, formularios y archivos incrustados se rechazan. Los nombres escapados
  también se inspeccionan. No se hace OCR ni se determina si un pago es auténtico.
- **Objetos e índices comprimidos PDF (ObjStm/XRef) no admitidos**: se rechazan
  globalmente antes de invocar pdf-lib, incluso con nombres escapados o referencias
  indirectas. Para ese PDF u otro formato no compatible, pedir JPEG/PNG o captura.
  Es un subconjunto conservador, no una promesa de admitir cualquier PDF válido.
- Los streams admitidos requieren longitud directa y filtro único Flate/DCT;
  pipelines, longitudes indirectas y DecodeParms se rechazan. Antes del parser,
  la descompresión tiene límites de 1 MiB por stream y 8 MiB acumulados. Hay
  límites de 2000 objetos y de recorrido del árbol de páginas, con ciclos inválidos.
- El PDF aprobado técnicamente se conserva sin renderizarlo ni ejecutar contenido.
  Su copia validada no se presenta como archivo saneado o certificado. La descarga
  CRM exige el permiso habitual, auditoría, attachment, nosniff, sandbox y no-store.
- Imágenes enviadas como documento conservan los mismos controles de imagen.
  Office, ZIP, ejecutables, HEIC y otros formatos no admitidos se rechazan con
  explicación, sin alterar el borrador ni convertir un archivo espontáneo en seña.
- **PDF WEB sólo con el validador pasivo existente**: las reservas web con Google
  o acceso invitado admiten PDF clásico validado, JPG, PNG y WebP de hasta 3 MB.
  No se admiten documentos con contraseña, contenido activo, Office, ZIP o MIME
  incompatible. La recepción queda en revisión manual y no confirma un pago ni
  extiende el plazo de la seña. Esta ampliación no certifica ni elimina archivos
  históricos almacenados y no cambia el circuito financiero F8.
- Sólo un pedido vigente que ya solicitó comprobante puede usar esta entrada como
  seña. La IA interpreta tipo/caption/contexto, no recibe los bytes del archivo ni
  aprueba pagos. El equipo revisa el comprobante; recepción no significa aprobación.
- No hay certificación de antivirus externo ni seguridad absoluta. Estos controles
  técnicos reducen riesgos y no sustituyen la revisión operativa pendiente.

## 4. Evidencia, vencimiento y trazabilidad

- `deposit-proof-writer.ts` inserta cada intento en `BookingDepositProof` con
  secuencia, tipo `INITIAL`, `RESUBMISSION` o `LATE`, tamaños y hashes. No
  sobrescribe intentos anteriores. La purga de bytes es una excepción controlada,
  no permiso para modificar libremente la evidencia.
- `expire-deposit-hold.ts` implementa trabajos reclamados `EXPIRE_DEPOSIT`, reloj
  de base y transiciones condicionales; no confundirlo con un cron de purga.
  Verificar workers activos en cada despliegue: tener código no garantiza ejecución.
- Un comprobante válido recibido dentro del plazo pasa a PROOF_RECEIVED y
  PENDING_PAYMENT_REVIEW. Ya no vence por el plazo de envío mientras el equipo
  lo revisa; no se elimina ni modifica el expiresAt financiero original.
- El comprobante tardío conserva evidencia y deriva a revisión del equipo;
  nunca reabre automáticamente una retención vencida ni recupera un horario.
- Revisión, vencimiento, purga y acceso tienen trazas específicas. No poner el
  contenido del comprobante en esas trazas ni en notificaciones/outbox.
- El recorrido legacy conserva su expiración perezosa y sus limitaciones. No
  usarlo para modificar parcialmente un agregado F8 o un grupo coordinado.

## 5. Política de retención y mecanismo disponible

La política declarada es **12 meses**. En F8 el writer fija `retentionEligibleAt`
a la fecha programada del turno más 12 meses; para evidencia `LATE`, a la recepción
más 12 meses. Este predicado actual no es una certificación legal ni implica que
los bytes se hayan eliminado al llegar esa fecha.

**Retención efectiva no certificada.** No hay cron de purga activado por este trabajo.
No se inspeccionaron programadores ni ejecuciones de infraestructura externa.
Existe la primitiva `deposit-proof-byte-purge.ts`: selecciona evidencia elegible
con reloj de base, lotes acotados y locks, elimina sólo `sourceData`/`derivedData`
y conserva fila, hashes, metadatos y auditoría `BookingDepositProofPurgeAudit`.
La operación de ejecución es idempotente; el modo `DRY_RUN` no elimina bytes.

El CLI `scripts/purge-booking-deposit-proof-bytes.ts` es **local-only**: exige URL
PostgreSQL loopback y `--allow-local-database=true`. Ejecutar además exige
`--execute=true`, `--confirm=PURGE_PROOF_BYTES` y clave de operación. No convertir
este manual en autorización para ejecutarlo ni usar credenciales de producción.
La política/purga F8 no certifica la retención de blobs legacy ni de backups.

**Legal hold pendiente:** no se acredita un mecanismo para detener una purga
por litigio o exigencia regulatoria. Antes de operar datos sujetos a hold,
resolver su protección o excluir esos casos; no ejecutar purgas incompatibles.

## 6. Infraestructura y aprobación operativa

**Backup y restore pendientes de verificación.** Requisitos de diseño: backup
diario, retención 30 días, RPO máximo 24 h y RTO máximo 4 h. Antes de habilitar
producción, comprobar cifrado en reposo, acceso restringido, copia de tablas de
evidencia y auditoría y un drill de restore que incluya PII. El código no prueba
que el proveedor cumpla esos requisitos. Backups conservan copias hasta rotación.

La ausencia de cifrado de campo no acredita cifrado del almacenamiento. No
mostrar ni registrar credenciales al comprobar estos controles. Ninguna prueba
local de este documento sustituye la aprobación del responsable operativo.

## 7. Checklist operativo e incidentes

- [ ] Aprobar política de retención, formatos permitidos y riesgo residual.
- [ ] Verificar legal hold o exclusión de casos sujetos a retención forzada.
- [ ] Verificar backup, cifrado, acceso a claves y drill de restore.
- [ ] Verificar capacidades/workers habilitados y backlog de vencimiento/revisión.
- [ ] Decidir y comprobar programación de purga, sin habilitarla implícitamente.
- [ ] Revisar usuarios con `canManageDeposits`, tenant y auditorías de acceso.
- [ ] Comprobar que logs/métricas/outbox no contienen PII ni recibos.

Ante exposición: acotar tenant/depósitos, suspender accesos indebidos, preservar
trazas sin copiar recibos a logs, comprobar aislamiento y backups, avisar al
responsable de privacidad y resolver conservación/borrado según la política y
posibles holds. La traza F8 no debe atribuirse retroactivamente a datos legacy.

## 8. Verificación local, sin aprobación de despliegue

`node node_modules/tsx/dist/cli.mjs scripts/deposit-security-contract-test.ts`
verifica permisos y contratos del código/documentación. Las suites específicas
de imagen, writer, revisión, vencimiento y purga verifican sus comportamientos;
las suites SQL requieren su entorno autorizado. Un PASS local no acredita
operación de backups, purga externa, calidad IA ni funcionamiento en WhatsApp.
