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
- App Secret de la aplicación de Instagram guardado en la conexión del comercio. Para Barber Demo se conserva temporalmente `INSTAGRAM_APP_SECRET` como fallback migratorio; `META_APP_SECRET` sólo aplica en instalaciones legacy donde Instagram y WhatsApp comparten la misma aplicación de Meta.
- Webhook con objeto Instagram, callback `/webhooks/instagram` y campo `comments` suscripto.
- La cuenta conectada también debe suscribir su aplicación al campo `comments` mediante `subscribed_apps`.

Cada comercio que use una Meta App propia carga en el CRM su **Instagram Account ID**, **token de acceso** y **clave privada de la app de Instagram**. Todas las apps pueden compartir la callback `/webhooks/instagram` y el mismo token de verificación. El servidor resuelve primero la cuenta incluida en el webhook y recién entonces valida `X-Hub-Signature-256` con la clave privada de ese comercio.

No mezclar este circuito con tokens o endpoints de **Instagram API with Facebook Login**. La integración implementada usa Instagram Login y `graph.instagram.com`.

### Estado de conexión en el CRM

El panel distingue **conexión guardada** de **cuenta comprobada**. Guardar o pulsar **Comprobar cuenta** consulta el mismo Instagram Account ID configurado; la respuesta de perfil puede devolver un ID propio de la aplicación distinto del ID profesional. No reemplazar la cuenta configurada usando `/me` ni exigir que ambos identificadores coincidan.

La comprobación y su fecha describen esa operación en la pantalla actual. Al recargar, el estado vuelve a **sin comprobar**: no se almacena un historial ni se garantiza que el token siga vigente. La fecha de vencimiento es **declarada manualmente**, incluso cuando aparece como pasada; si falta, se presenta como desconocida. Los avisos operativos (por ejemplo, falta de WhatsApp) son independientes de la consulta de perfil.

Leer el perfil **no confirma** permisos de métricas, publicaciones/historias, comentarios o mensajes, suscripciones webhook ni disponibilidad de workers/storage. Esas funciones permanecen con **permisos sin verificar** hasta implementar su verificación específica. Los errores del proveedor no se devuelven literalmente al navegador para evitar exponer credenciales.

Contrato local, sin credenciales reales ni conexión a bases remotas:

```text
npm run test:instagram-settings
```

## 2. Almacenamiento

Crear un **bucket privado** en Supabase Storage. El nombre recomendado es `instagram-reels` y se configura con:

```dotenv
SUPABASE_INSTAGRAM_REELS_BUCKET=<nombre-del-bucket-privado>
INSTAGRAM_REEL_MAX_BYTES=52428800
INSTAGRAM_REEL_SIGNED_READ_TTL_SECONDS=21600
```

El bucket debe admitir `video/mp4` y `video/quicktime`. Para el piloto se usa un límite de 50 MiB, alineado con el límite global actual del proyecto Supabase. El navegador recibe únicamente una URL temporal de subida; `SUPABASE_SERVICE_ROLE_KEY` nunca se entrega al cliente. Meta descarga el video mediante otra URL temporal generada exclusivamente en el servidor.

El archivo fuente se elimina automáticamente del bucket cuando pasaron **24 horas desde `publishedAt`**. Esta limpieza no elimina el Reel de Instagram ni borra la publicación, su automatización o su historial en Weex. Si Supabase falla, el trabajo libera su reserva y se reintenta en un ciclo posterior; nunca se registra el archivo como eliminado antes de confirmar el borrado.

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

## 8. Catálogo y observaciones de alcance (backend)

El catálogo importado es independiente del bucket de videos, los workers de publicación y la opción **Bot de Instagram**. No requiere activar el bot ni `INSTAGRAM_REELS_ENABLED`. Su migración local revisable es `20261024190000_add_instagram_media_insights`; no se aplica automáticamente a producción durante desarrollo. Las credenciales permanecen en el servidor. No existe sincronización automática al iniciar ni al consultar datos guardados.

- `GET /businesses/:businessId/instagram-media`: lee caché de la cuenta configurada, con `kind=REELS`, `sort=publishedAt|reach|views`, `from`/`to` (fechas o instantes ISO), `limit` y `offset`. Las fechas sin hora se interpretan en UTC; enviar instantes ISO con zona para rangos locales. Orden descendente y valores desconocidos al final. Devuelve `items,total,accountId,limit,offset,linkedPublicationIds`; estos últimos identifican publicaciones del CRM importadas **antes** de aplicar filtros o paginación para evitar duplicados en cualquier página. La procedencia se deriva únicamente de comercio y `metaMediaId`, sin inventar un video fuente o automatización para contenido externo.
- `POST /businesses/:businessId/instagram-media/sync`: petición explícita, cuerpo vacío o `{continuation}`. Cada petición importa como máximo cinco registros y consulta métricas solo si `media_product_type=REELS`; `media_type=VIDEO` no basta. Hasta tres consultas de métricas simultáneas, cada llamada con un plazo de cinco segundos (hasta unos quince segundos de proveedor, más persistencia). Una cuenta grande necesita varias peticiones explícitas. El estado responde `more|complete|partial|failed`, cantidades de esta página, código de error fijo y continuación opaca o `null`. Una página parcial puede estar terminada: continuar solo cuando `continuation` no sea `null`.
- `GET /businesses/:businessId/instagram-media/:mediaId/history`: historial de observaciones reales, descendente, con `limit`/`offset`, jamás una reconstrucción de días anteriores a la importación.

La continuación es un identificador temporal de servidor; nunca una URL de Meta ni su cursor sin proteger. Vence a la hora, se vincula al comercio/cuenta/credencial y usa una reserva de un minuto para impedir procesamientos simultáneos de la misma página. El cliente reutiliza la continuación devuelta ante un fallo de lectura. Un cursor repetido, una cuenta/credencial cambiada o una continuación vencida/en uso responde conflicto; reiniciar una sincronización es seguro. Se construye siempre el endpoint propio, sin seguir `paging.next`. La revalidación de cuenta y la persistencia se serializan con un bloqueo corto sobre su configuración, después de terminar las llamadas de red.

Los datos guardados incluyen `latestMetrics.values` (último valor válido por métrica) y `observedAtByMetric` (su fecha individual); no etiquetar toda esa caché como recién actualizada. `lastInsightAttemptAt`, `insightsStatus` y `insightsErrorCode` describen el último intento. `latestObservation` e historial conservan los siete valores crudos, incluidos `null`, período devuelto, estado y versión de API. Un fallo o respuesta parcial conserva la caché previa; observaciones que terminan fuera de orden se agregan al historial sin retroceder valores, fechas, estado o metadatos más nuevos. `lastSyncedAt` corresponde a la consulta de metadatos, no a la vigencia de cada métrica.

Se solicitan los contadores orgánicos `views,reach,likes,comments,shares,saved,total_interactions`. Solo un valor numérico entero no negativo con **una muestra y `period=lifetime`** se acepta como total; series, período ausente/diferente o datos no disponibles quedan desconocidos. Cero observado es válido; desconocido se guarda como `null`. No sumar alcances de publicaciones como si fueran personas únicas. La conexión de perfil no prueba permisos: esta operación requiere Instagram Login `instagram_business_basic` y `instagram_business_manage_insights`, sujetos al acceso efectivo de la app/cuenta.

La documentación vigente introduce `views` el 21 de enero de 2025 y depreca métricas de reproducciones anteriores desde v22. La integración conserva la versión configurada (actualmente v25.0); versiones anteriores a v22 dejan insights no disponibles, sin actualización silenciosa. La matriz vigente documenta los siete contadores para Reels, pero no garantiza disponibilidad para toda cuenta o versión futura. Errores de permisos/versión/cuota se muestran sin inventar números ni exponer mensajes originales. Referencias primarias: https://developers.facebook.com/documentation/instagram-platform/changelog , https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media/insights y https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/get-started .

Verificación local sin cuentas reales ni base remota: `npm run test:instagram-media`, incluido en `npm run test:instagram-reels`.

## 9. Consulta del catálogo en el CRM

En **Marketing → Instagram Reels**, la tabla de publicaciones importadas muestra alcance y vistas orgánicas, con interacciones desplegables. Cada valor conserva su fecha individual de observación; **Sin datos** no equivale a cero. El último intento puede ser parcial o fallido mientras siguen visibles valores anteriores. El historial se abre a pedido y pagina observaciones reales desde la primera sincronización.

Los filtros **Publicado desde/hasta** seleccionan fechas de publicación, no ventanas de medición. El navegador convierte los límites del día local en instantes ISO con zona. El orden permite publicación reciente, mayor alcance o vistas; los desconocidos quedan al final según el contrato del catálogo. La paginación de datos guardados y la continuación de importación son independientes.

**Releer datos guardados** solo consulta la caché. **Sincronizar Instagram** inicia explícitamente una cadena de páginas acotadas y muestra publicaciones procesadas. **Pausar**, cambiar de sección o esconder la pestaña detiene nuevas páginas al terminar la petición en curso. Ante error se pausa y, cuando existe una continuación vigente, se ofrece continuar; una continuación vencida requiere comenzar otra sincronización. No hay sincronización automática desde apertura, SSE o polling.

Las creaciones del CRM se mantienen separadas: borradores, cola y publicaciones todavía no importadas. Los vínculos globales excluyen duplicados incluso cuando la fila importada está en otra página o fuera del filtro. Una indisponibilidad del almacenamiento de publicaciones no impide consultar el catálogo; errores de lectura conservan la última caché. Cambiar comercio, demo, cuenta o guardar credenciales invalida continuaciones e historial y descarta respuestas tardías.

Prueba de interacción local: `npm run test:instagram-media-ui`, incluida en el agregado de Reels. La fixture neutral se genera con `tsx scripts/instagram-media-ui-fixture.ts <directorio-local>`; reutiliza markup, estilos, funciones y bindings de producción con respuestas falsas. No abre una sesión de cliente ni llama a Meta. Esta fixture no sustituye una verificación del CRM completo ni acredita una prueba visual hasta observar el navegador.

## 10. Acciones independientes por comentario (backend)

Se conserva el uploader y la respuesta privada existente. La automatización puede agregar una **respuesta pública** opcional, configurar un Reel importado sin video fuente o reconocer la misma automatización de una publicación del CRM. No crea otro scheduler: el único worker de comentarios reclama acciones `PUBLIC_REPLY` y `PRIVATE_REPLY` independientes. Repetir el webhook, incluso después de editar la configuración, no agrega acciones a una ejecución existente.

`GET`/`PATCH /businesses/:businessId/instagram-media/:mediaId/automation` y las mismas operaciones en `/instagram-publications/:publicationId/automation` comparten el resolver transaccional por cuenta profesional, catálogo y publicación. La variante local requiere estado `PUBLISHED`: borradores/cola mantienen su editor actual; desacoplar publicación de automatización corresponde a la entrega posterior del calendario. No se fabrican publicaciones para contenido externo. Registros incompatibles responden conflicto, conservando IDs y referencias anteriores.

El cuerpo de guardado contiene `enabled,keywords:string[],privateReplyEnabled,privateReplyText,publicReplyEnabled,publicReplyText`. Una automatización activa necesita palabras clave y al menos una acción con texto. Pausar permite palabras vacías y conserva textos de acciones apagadas, dentro de sus límites. El texto público activo rechaza placeholders/enlaces privados de formularios. La respuesta incluye `accountId,mediaId,publicationId,automation` y hasta20 `recentActions` con `id,executionId,kind,status,attempts,sentAt,lastError`; el error mostrado es fijo y sanitizado. Guardar configuración no envía respuestas.

El worker verifica por GET la identidad real del comentario, autor y media; un `parent_id` identifica una respuesta y se descarta. Si faltan datos necesarios o no coinciden, no envía. La ausencia de `parent_id` se interpreta condicionalmente como comentario raíz, sin exigir un null no garantizado por Meta. Solo el privado exige además un `timestamp` real con zona dentro de siete días; `entry.time` del webhook nunca acredita creación. Fallos transitorios de lectura (429/5xx/timeout) reintentan con límites desde `CLAIMED`, antes de iniciar cualquier POST; identidades/fechas no verificables no se envían. Después de la lectura, la transición a envío revalida cuenta, habilitación, acción, destino y palabras clave bajo la misma exclusión de configuración, sin llamadas de red dentro de esa transacción. La continuación por DM permanece con sus reglas existentes de respuesta del usuario y ventana. El éxito público guarda su reply ID, sin mensaje privado ni lead. Un privado inválido no impide procesar la acción pública.

Cada acción conserva su propio lease, intentos y resultado. Un timeout ambiguo, respuesta sin ID, pérdida de fence o fallo al persistir después de un POST no habilita reenvío: termina `UNKNOWN` o queda `SENDING` hasta que expire como `UNKNOWN`. No reintentar manualmente un `UNKNOWN` sin comprobar Instagram. Cambiar cuenta no reasigna trabajo recibido: se exige la cuenta profesional capturada, aunque el perfil use otro ID propio de la app. Formularios privados siguen firmando el execution ID anterior y mantienen publicación cuando existe; los importados atribuyen media/cuenta reales sin publicación inventada.

**Prerrequisito de un futuro despliegue, no ejecutado durante desarrollo:** pausar/controlar el ingreso para que no entren nuevos pendientes, drenar la cola privada antigua y comprobar ausencia de `READY/RETRY/CLAIMED` antes de detener TODOS los workers viejos. Un `SENDING` incierto debe tratarse como `UNKNOWN`, nunca reenviarse. Luego aplicar `20261026180000_instagram_comment_actions`, regenerar el cliente y arrancar exclusivamente el worker nuevo; recién entonces reanudar el ingreso controlado. Nunca coexistir con procesos que reclamen la tabla antigua de ejecuciones. La migración crea una sola acción privada por ejecución, preserva estados/evidencia y convierte `SENDING` en `UNKNOWN`; no crea públicos retroactivos ni asigna una cuenta histórica a partir de la configuración actual. Si se retienen pendientes legacy `READY/RETRY/CLAIMED` sin cuenta de recepción verificable, no continúan automáticamente: el worker nuevo los marca `SKIPPED` conservando el registro/evidencia para revisión auditada. No se fuerza su envío ni se asume que todos los pendientes se reanudarán. Los `SENT/UNKNOWN` siguen sin reenviarse.

Los comentarios importados requieren enablement/rollout explícitos y tablas compatibles, pero no almacenamiento de uploads. Sin storage, publicaciones/retención siguen indisponibles mientras el mismo scheduler puede procesar comentarios. No se activa ninguna cuenta, permiso o runtime por guardar configuración. Pruebas offline: `npm run test:instagram-comment-actions` (incluye formularios existentes) y el agregado `npm run test:instagram-reels`; fakes deterministas y SQL/PGlite no acreditan concurrencia real de PostgreSQL ni pruebas de Meta.

### Controles del CRM

**Configurar respuestas** abre un único panel dentro de Instagram Reels, tanto en el catálogo importado como en creaciones del CRM con estado publicado. Los borradores mantienen su editor actual. El panel conserva palabras clave, texto privado y placeholders de formularios existentes; permite seleccionar por separado comentario público y mensaje privado. Una configuración inexistente se muestra sin configurar y no se guarda al abrirla.

**Guardar cambios** envía la configuración completa; **Pausar automatización** conserva los textos y desactiva la automatización. Las acciones apagadas no requieren texto. Los errores aparecen en el panel y conservan las ediciones sin fingir éxito. La tabla inferior separa resultados públicos y privados, intentos y fecha de envío; un resultado incierto se revisa en Instagram, sin botón de reenvío.

Cerrar, cambiar comercio/cuenta o salir de la sección descarta el editor y sus respuestas tardías. Al cerrar se devuelve el foco al control de origen cuando todavía existe. Abrir/guardar utiliza únicamente rutas de configuración, sin subir videos ni iniciar una sincronización o respuesta a Meta. Pruebas del panel incluidas en `npm run test:instagram-media-ui`; la fixture neutral compartida se genera con `tsx scripts/instagram-media-ui-fixture.ts C:/Users/cpu/salon-ai/tmp/instagram-comment-ui-qa` y nunca utiliza sesiones reales.

### Programación durable (API; calendario pendiente)

`POST /businesses/:businessId/instagram-publications/:publicationId/schedule` recibe `scheduledAt` (ISO con segundos y `Z` u offset explícito) y `expectedRevision` (entero no negativo). El instante debe ser futuro, también después de esperar los bloqueos. La zona IANA canónica se copia de `Business.timezone`; falta/valor inválido devuelve409, nunca se usa la zona del navegador. El horario deseado y su zona se conservan separados de `availableAt`, que sólo controla consultas y backoff. GET/lista incluyen ambos horarios, revisión, destinatarios y fecha real de publicación.

Se puede programar un DRAFT o CANCELLED con archivo disponible, o reprogramar SCHEDULED mientras ningún worker lo haya tomado. `POST .../:publicationId/cancel` requiere `expectedRevision`. Un horario vencido todavía puede cancelarse/reprogramarse si sigue sin reclamar; revisión vieja, claim o procesamiento producen409. El mismo worker durable publica al llegar el horario, incluso después de una caída, conservando el horario original para calcular la demora. No hay otro scheduler ni ventana máxima inventada. Este cambio no agrega calendario ni desacopla las reglas actuales del borrador/automatización.

Encolar/programar guarda identidad profesional y destino API efectivos; cada ejecución vuelve a comprobar ambas identidades, habilitación, archivo y lease antes de firmar la URL temporal y antes de cada POST. Rotar token con las mismas identidades es válido; cambiar de cuenta no redirige trabajos antiguos. Una respuesta ambigua permanece UNKNOWN y no se reenvía. Antes de un futuro despliegue: controlar ingreso, drenar publicaciones pendientes con workers viejos y detenerlos antes de migrar/arrancar la versión nueva. Los pendientes legacy sin identidad histórica verificable fallan conservadoramente para revisión manual; no se les asignan las credenciales actuales. No se ejecutó ningún paso en producción.

SCHEDULED, CANCELLED, reintentos e inciertos retienen el archivo; la limpieza automática sólo considera PUBLISHED y24h desde `publishedAt` real, nunca desde `scheduledAt`. El borrado explícito de un CANCELLED invalida primero su elegibilidad con `videoDeleteRequestedAt` y revisión nueva, antes de acceder al storage. Si falla el borrado, el archivo sigue bloqueado para publicar/reprogramar, `videoDeletedAt` permanece vacío y se puede repetir el borrado explícito. Sólo el borrado confirmado completa `videoDeletedAt`. Pruebas offline: `npm run test:instagram-scheduling` (servicio/worker, rutas con guard real y migración/predicados SQL en PGlite). Intercalados deterministas y PGlite no acreditan concurrencia de sesiones PostgreSQL reales.
