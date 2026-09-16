# Piloto Instagram → landing/formulario → Pipeline (Barber Demo)

Estado: **DRAFT, sin alta ni publicación**. `leadCaptureFormsEnabled=false` continúa siendo el default. La implementación local no aplicó migraciones, no regeneró Prisma, no mutó la base real y no activó el comercio.

## Alcance del piloto

Barber Demo usa explícitamente `rewardMode=NONE`. El camino crítico es Instagram → landing/formulario → Pipeline: una respuesta válida crea exactamente una `FormSubmission` ACCEPTED, un `PipelineLead` y su evento SYSTEM. La respuesta pública debe contener `benefitAvailable=false` y `rewardClaim=null`.

`NONE` no crea `RewardClaim`, no entrega LINK ni FILE y no requiere `LEAD_REWARD_TOKEN_SECRET`, `LEAD_REWARD_ENCRYPTION_KEY` ni bucket. Esto es una decisión de producto explícita, no una degradación causada por un reward ausente.

`BENEFIT` conserva el contrato seguro: una submission ACCEPTED requiere exactamente un `RewardClaim` atómico para un reward habilitado del mismo Business/form. Un reward ausente, deshabilitado o cruzado falla cerrado en publicación y submit; nunca se interpreta como `NONE`.

La administración FILE/PDF está **diferida** a otro cambio. El editor del piloto solo ofrece NONE o BENEFIT con LINK/DISCOUNT/TEXT.

## Rollout autorizado

1. Revisar y aplicar, en este orden, la migración base de formularios y `20260915220000_add_lead_form_reward_mode`; después regenerar Prisma. No ejecutar estos pasos desde la implementación local.
2. Mantener Barber Demo DRAFT con `rewardMode=NONE`.
3. Configurar `LEAD_FORM_RATE_LIMIT_SECRET` e `INSTAGRAM_FORM_REF_SECRET` fuertes. Los secretos reward no son prerrequisito para NONE.
4. Configurar `LEAD_FORM_TRUSTED_PROXY_IPS` con IPs exactas. Verificar dos clientes y que un peer no confiable no pueda falsificar `X-Forwarded-For`.
5. Verificar host → customerCode → Business, Pipeline habilitada, etapa activa y fixture contra la landing sin romper reservas.
6. Ejecutar el E2E en **staging o un entorno controlado autorizado**, después de las migraciones, Prisma generate y configuración: allí el flag debe estar **temporalmente habilitado** y el formulario publicado para que las rutas públicas acepten el submit. Probar enlace firmado de Instagram → landing → submit → exactamente una submission, un lead y un evento SYSTEM → `benefitAvailable=false`, `rewardClaim=null`. Restaurar el flag/formulario del entorno de prueba según su plan de rollback.
7. Repetir misma Idempotency-Key y payload: mismo resultado, sin duplicados. Misma key con payload distinto: 409. Verificar 422, 429, tenant cruzado y attribution/ref inválida.
8. Capturar evidencia de DB, respuesta, logs sin PII, headers `no-store`/`no-referrer` y reservas intactas.
9. En **producción no activar** el flag ni publicar Barber Demo antes de obtener PASS del E2E controlado y aprobación explícita. Recién entonces habilitar el flag para Barber Demo y publicar. LINK/FILE no son gate del piloto NONE.

## Gates locales y reales

Los contratos locales cubren schema/migración estática, NONE/BENEFIT, atomicidad, replay, rutas, UI, UTF-8 y reservas. No sustituyen PostgreSQL, proxy, host ni navegador reales. El E2E autorizado debe probar Instagram → landing → Pipeline y confirmar que no aparece CTA ni link de beneficio en NONE.

Con `leadCaptureFormsEnabled=false` o el formulario en DRAFT, el servicio responde `FORM_NOT_AVAILABLE`: esos estados solo permiten verificar el rechazo fail-closed, NO ejecutar un submit E2E exitoso. El estado real actualmente verificado sigue siendo NO-GO: ambas migraciones de formularios están pendientes en Supabase, la baseline remota no aparece localmente, el cliente Prisma generado no conoce `LeadCaptureForm` y el servidor local no está activo. No aplicar migraciones ni forzar baseline hasta conciliar el historial con el operador.

## Rollback

Despublicar el formulario y/o volver el flag a false. Conservar submissions, leads, eventos y cualquier claim BENEFIT existente. Una submission NONE sin claim es válida, no corrupción. No borrar datos ni objetos requeridos por claims. Mantener FILE/PDF diferido.
