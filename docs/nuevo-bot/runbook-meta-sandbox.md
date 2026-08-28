# Runbook — Meta sandbox F10.6

## Estado y límite

Este runbook separa evidencia local controlada de validación live. El contrato
controlado ya da `CONTROLLED_PROVIDER_PASS` y satisface F10.6 según la definición
del plan (`[META]` significa sandbox/proveedor controlado); no contacta Meta. El
preflight live puede terminar únicamente en `META_LIVE_PENDING`: **no consulta
Prisma, no abre red, no envía Meta y no habilita runtime**. `META_LIVE_PASS` no
existe todavía y no bloquea F10; queda como evidencia opcional de piloto/F11.

No incluir secretos, teléfonos, IDs de negocio, `phoneNumberId`, payloads ni
headers en terminales compartidas, tickets, capturas, logs o commits. Guardar
sólo los labels de resultado y evidencia redactada.

## Preflight fail-closed

En una shell privada, cargar secretos desde el mecanismo operativo aprobado y
definir, sin imprimir valores:

- `F10_6_LIVE_SANDBOX_ENABLE` exactamente
  `F10_6_LIVE_SANDBOX_PREFLIGHT_ONLY`.
- `F10_PG_CONTRACT_DATABASE_URL`: scratch local F10 que pase
  `assertF10PgContractDatabaseUrl`; el preflight no la copia a `DATABASE_URL`.
- `F10_6_LIVE_SANDBOX_BUSINESS_ID` y
  `F10_6_LIVE_SANDBOX_EXPECTED_DEMO_TYPE=QA_SANDBOX`.
- `WHATSAPP_PHONE_NUMBER_ID`, `F10_6_LIVE_SANDBOX_SENDER_E164` y
  `F10_6_LIVE_SANDBOX_RECIPIENT_E164`, todos explícitos y normalizados. Sender
  y recipient deben ser distintos.
- `F10_6_LIVE_SANDBOX_RECIPIENT_ALLOWLIST_E164`: exactamente el único recipient
  E.164 permitido; no acepta listas, espacios ni valores adicionales.
- `F10_6_LIVE_SANDBOX_RECIPIENT_OPT_IN` exactamente
  `F10_6_RECIPIENT_OPT_IN_CONFIRMED` después de verificar consentimiento actual.
- presencia no vacía de `WHATSAPP_ACCESS_TOKEN` y `META_APP_SECRET`.
- `F10_6_LIVE_SANDBOX_WEBHOOK_URL` HTTPS sin credenciales, query ni fragment.
- todos los flags existentes `BOT_OPTIONS_*` ausentes o exactamente `false`.
  En particular, shadow, authoritative processing, workers, sender y todas las
  capabilities continúan desactivados.

Ejecutar sólo el comando aislado:

```sh
npm run preflight:f10-6-live-sandbox
```

Un éxito imprime sólo `META_LIVE_PENDING`. Cualquier otro resultado es rechazo;
registrar únicamente `F10_6_LIVE_SANDBOX_PREFLIGHT_REFUSED:<CODE>`. Este comando
no integra `npm test` ni una suite normal.

## Requisito de inbound y evidencia futura

Una futura prueba live requiere un mensaje **inbound originado por el operador**
desde el recipient con opt-in; nunca iniciar un mensaje automático para provocar
la prueba. Antes de cualquier I/O futuro, una etapa explícita debe leer la
identidad de negocio indicada y comprobar `isDemo=true` y `demoType='QA_SANDBOX'`
contra la scratch F10 ya validada. Si falla o no existe, termina sin send.

La evidencia mínima para una futura aprobación es: timestamp redondeado, labels
de preflight, prueba de inbound del operador, correlación redactada de CRM y
callbacks `statuses`, más evidencia de cero autorespuestas durante TAKE y del
retorno sólo después de RESUME/HOME. No guardar valores de identificadores,
teléfonos, tokens, secretos ni cuerpos de webhook.

## Cleanup y revocación

Al terminar, deshabilitar/revocar el token sandbox según Meta, remover las
variables de la shell/secret store temporal y confirmar que todos los
`BOT_OPTIONS_*` siguen false/ausentes. No borrar evidencia durable ni tocar una
DB compartida. Cualquier `UNKNOWN`, callback faltante, destinatario no permitido
o duda de consentimiento bloquea el avance y conserva estado `META_LIVE_PENDING`.
