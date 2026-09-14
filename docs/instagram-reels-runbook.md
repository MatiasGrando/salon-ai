# Instagram Reels: publicación y automatización por comentarios

Este procedimiento activa el flujo **Reel → comentario con palabra clave → una respuesta privada → continuidad por DM**. La capacidad permanece apagada por defecto y no debe habilitarse hasta completar todos los pasos.

## 1. Requisitos de Meta

- Cuenta profesional de Instagram conectada mediante **Instagram Login**.
- Token vigente para la misma cuenta que se guarda en Weex.
- Acceso aprobado a:
  - `instagram_business_basic`
  - `instagram_business_content_publish`
  - `instagram_business_manage_comments`
  - `instagram_business_manage_messages`
- App Secret de la aplicación de Instagram disponible en el servidor mediante `INSTAGRAM_APP_SECRET`. `META_APP_SECRET` sólo queda como fallback para instalaciones donde Instagram y WhatsApp usan la misma aplicación de Meta.
- Webhook con objeto Instagram, callback `/webhooks/instagram` y campo `comments` suscripto.
- La cuenta conectada también debe suscribir su aplicación al campo `comments` mediante `subscribed_apps`.

No mezclar este circuito con tokens o endpoints de **Instagram API with Facebook Login**. La integración implementada usa Instagram Login y `graph.instagram.com`.

## 2. Almacenamiento

Crear un **bucket privado** en Supabase Storage. El nombre recomendado es `instagram-reels` y se configura con:

```dotenv
SUPABASE_INSTAGRAM_REELS_BUCKET=<nombre-del-bucket-privado>
INSTAGRAM_REEL_MAX_BYTES=52428800
INSTAGRAM_REEL_SIGNED_READ_TTL_SECONDS=21600
```

El bucket debe admitir `video/mp4` y `video/quicktime`. Para el piloto se usa un límite de 50 MiB, alineado con el límite global actual del proyecto Supabase. El navegador recibe únicamente una URL temporal de subida; `SUPABASE_SERVICE_ROLE_KEY` nunca se entrega al cliente. Meta descarga el video mediante otra URL temporal generada exclusivamente en el servidor.

Verificar CORS del proyecto de Supabase para el origen HTTPS del CRM antes de la prueba operativa.

## 3. Base de datos

Respaldar la base y revisar el destino de `DATABASE_URL`. Luego aplicar conscientemente la migración:

```text
20260913030000_add_instagram_reels_automation
```

La migración agrega publicaciones, automatizaciones, palabras clave y ejecuciones. No habilitar los workers si esas tablas todavía no existen.

## 4. Variables del runtime

Mantener inicialmente:

```dotenv
INSTAGRAM_REELS_ENABLED=false
INSTAGRAM_REELS_BUSINESS_IDS=
INSTAGRAM_REELS_WORKER_INTERVAL_MS=5000
```

Ejecutar primero:

```text
npm run test:instagram-reels
```

Configurar `INSTAGRAM_REELS_BUSINESS_IDS` con los identificadores internos separados por coma de los comercios habilitados. No usar nombres ni códigos de cliente. Activar `INSTAGRAM_REELS_ENABLED=true` **después** de confirmar permisos, firma, bucket, migración y token. Si la allowlist está vacía, el runtime falla cerrado. Al iniciar, verifica storage y tablas. Si algo falta, las rutas permanecen indisponibles y los comentarios reciben una respuesta reintentable en lugar de perderse.

## 5. Prueba controlada

1. Usar una cuenta de prueba y un Reel corto sin audiencia comercial.
2. Crear el Reel desde **Marketing → Instagram Reels** con una palabra poco probable, por ejemplo `PRUEBAWEEX2026`.
3. Confirmar la secuencia de estados: `DRAFT`, `READY`, procesamiento y `PUBLISHED`.
4. Comentar desde otra cuenta usando exactamente la palabra configurada.
5. Confirmar una sola respuesta privada por comentario.
6. Responder ese DM y verificar que el asistente actual continúe la conversación.
7. Reenviar el mismo webhook y confirmar que no se cree otra ejecución ni otro mensaje.

## 6. Seguridad y recuperación

- Todo webhook con comentarios debe validar `X-Hub-Signature-256` sobre los bytes originales.
- Un comentario se deduplica por comercio e ID de comentario.
- La respuesta privada inicial se envía una única vez; la persona debe responder para continuar la conversación normal.
- `UNKNOWN` significa que Meta pudo haber recibido una operación aunque Weex no obtuvo una respuesta concluyente.
- **No reintentar automáticamente un estado `UNKNOWN`**. Revisar el Reel, comentario o conversación en Instagram antes de decidir una acción manual.
- No registrar tokens, App Secret, service role, URLs firmadas ni cuerpos con datos personales en logs de error.

## 7. Observación inicial

Durante el primer Reel real, controlar:

- publicaciones en `FAILED` o `UNKNOWN`;
- ejecuciones de comentarios en `RETRY`, `FAILED` o `UNKNOWN`;
- respuestas HTTP 403, 429 y 5xx de Meta;
- vencimiento del token;
- demoras del procesamiento del contenedor;
- cola que crece sin disminuir.

Si el circuito no está sano, volver `INSTAGRAM_REELS_ENABLED=false`. Eso detiene nuevas publicaciones y respuestas automáticas sin eliminar los registros existentes.
