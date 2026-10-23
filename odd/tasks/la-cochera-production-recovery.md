# Recuperación de publicación de La Cochera

## Objetivo y autorización

Restaurar en producción la versión de la reserva que ya incluía navegación responsive y miniaturas de servicios, conservando la landing V13 de La Cochera y su portada liviana de WhatsApp. Además, hacer que los CTA de reserva de la landing se abran en la pestaña actual. El usuario reportó que la publicación anterior pisó cambios existentes y autorizó continuar la corrección el 23/10/2026.

## Evidencia y alcance

La publicación anterior se armó desde `d3ada31`, cuya base no incluye `d190949` (`feat(booking): add responsive progress navigation and service thumbnails`). La rama reciente `codex/new-bot-multivertical` en `938af67` sí lo contiene. Esta recuperación parte de ese commit y reincorpora solo los recursos y rutas exactas de La Cochera; no cambia reservas, catálogo, profesionales, datos ni migraciones. Los CTA de reserva propios se mantienen dentro de la pestaña; los enlaces externos a WhatsApp, Maps, Google y redes conservan su comportamiento actual.

## Configuración

- Ruta: delegated direct requerida por preparación y varios archivos. Los workers disponibles no pudieron iniciar por límites del entorno; el padre ejecuta la unidad acotada.
- TDD ON por `openspec/config.yaml`. Runner focalizado: `node --import tsx scripts/la-cochera-hosting-contract-test.ts`; comprobar RED antes de integrar y GREEN después. Ejecutar además contratos de reserva afectados y `npm run test:text-encoding`.
- Publicación autorizada: Railway, proyecto `tender-fulfillment`, servicio `salon-ai`, entorno `production`. No ejecutar migraciones.
- Engram no está disponible: espejo `odd/la-cochera-production-recovery/tasks` pendiente.

## Tareas

- [x] REC1 — Reincorporar la landing V13 y recursos OG sobre `938af67`, sin reemplazar los cambios de reserva posteriores. Comprobar que `d190949` y sus miniaturas siguen presentes.
- [x] REC2 — Hacer que los CTA propios a `lacochera.weex.com.ar/reservar` naveguen en la pestaña actual y cubrirlo con una prueba de contrato.
- [ ] REC3 — Validar landing, miniaturas de reserva y ambas direcciones; publicar en Railway y verificar públicamente el resultado.

## Aceptación

La landing y la reserva muestran el diseño y datos correctos. La reserva conserva miniaturas de servicio y navegación responsive. Sus CTA propios cargan en la misma pestaña. Ambos dominios sirven la landing V13 y la portada JPEG de WhatsApp. Sin migraciones ni degradación de rutas existentes.

## Evidencia de progreso

- REC1: `d190949` es ancestro de esta recuperación; `src/routes/public-booking.ts` permanece idéntico a `938af67`. `node --import tsx scripts/public-booking-services-ui-contract-test.ts` pasó.
- REC2: la prueba de contrato nueva falló antes del cambio porque los enlaces tenían `target="_blank"`; luego pasó y comprueba los ocho CTA de `published-v13.html` e `index.html`.
- Verificaciones locales: contrato de hosting de La Cochera, contrato de servicios de reserva y `npm run test:text-encoding` pasaron. La prueba visual con Playwright quedó pendiente porque esa dependencia no está instalada en este entorno.
