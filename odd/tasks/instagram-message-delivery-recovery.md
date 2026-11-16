# Recuperar entrega de mensajes de Instagram

El webhook de Instagram entra y devuelve 200, pero el CRM muestra respuestas que Meta acepta sin que aparezcan en el inbox de la persona. No se debe sustituir `apiAccountId` por `instagramAccountId`: pueden diferir de forma legítima y el primero es el recurso de envío validado por Meta. Falta registrar de forma segura qué cuenta recibió Meta, el identificador devuelto y el rechazo exacto si ocurre.

- [x] IDR1. Registrar de manera segura la aceptación o el rechazo del envío Instagram en el proveedor de salida, sin tokens ni identificadores completos de clientes; cubrir éxito y error con una prueba de contrato.
- [x] IDR2. Verificar el contrato de envío, la codificación UTF-8 y dejar preparado el dato preciso para comprobar un DM real en producción.

Ruta delegada directa: el mapa abarcó configuración, webhook, admisión, canal runtime, proveedor y pruebas. El escritor cubre proveedor y prueba no triviales. TDD estricto según `openspec/config.yaml`; RED, GREEN y REFACTOR con runner focalizado de Instagram; `npm run test:text-encoding` antes del commit. Forecast 80–140 líneas. Estrategia `ask-on-risk`. Alcance local; el despliegue y la consulta a Meta quedan sujetos a autorización posterior. Espejo Engram pendiente por falta de herramienta.

Progreso: diagnóstico confirmado. `apiAccountId` puede diferir legítimamente de `instagramAccountId` y ambos caminos existentes lo usan para el POST a Meta. El webhook 200 confirma ingreso, no entrega. IDR1 completado: RED observado por export ausente; GREEN en `scripts/instagram-outbox-delivery-audit-contract-test.ts` y `scripts/instagram-shared-bot-runtime-test.ts`; UTF-8 verificado con `npm run test:text-encoding`. El registro sólo incluye resultado, comercio, cuenta usada, últimos cuatro dígitos del destinatario e identificador/códigos devueltos por Meta. IDR2 completado: el runtime compartido de Instagram pasó. Pendiente sólo la prueba real posterior a un despliegue autorizado.
