# Catálogo y reservas por sede · Glow (etapas 1 y 2)

Servicios y profesionales consultan `GET /public/glow/branches/:branch/catalog`.
El servidor resuelve únicamente `urquiza` (WX-QG5FQA) y `canitas` (WX-NPP7HE).
No hay datos ficticios ni catálogo alternativo si el servidor no está disponible.
Los dos banners editoriales y las acciones de consulta por WhatsApp permanecen sin cambios.
Los botones de reservar abren `/reservar?sede=urquiza` o `sede=canitas`.
El paso inicial confirma la sede y su dirección real antes de derivar a la reserva
canónica de Weex. Sin sede explícita, el visitante debe elegirla.

## Desarrollo

Vite deriva `/public/glow` al backend local `http://127.0.0.1:3000`.
Si el backend usa otro puerto, establecer `GLOW_API_PROXY_TARGET` antes de iniciar
`npm run dev`. El backend necesita tener instalada la ruta de catálogo Glow.

## Publicación en glow.weex.com.ar

El código fuente se conserva en `sites/peluqueria-glow-web` dentro del repositorio
Weex. El pipeline remoto prepara sus artefactos con `build:glow`; no ejecutar builds locales.
Fastify sirve `/`, `/reservar`, recursos Vite con hash y medios públicos autorizados
únicamente en el host `glow.weex.com.ar`. El API `/public/glow` usa el mismo origen:
no se necesitan CORS ni variables públicas para esta publicación.
No copiar `node_modules`, `.env` ni `dist` al repositorio.
Las imágenes del catálogo deben ser URLs públicas accesibles desde la landing.

## Verificación

`npm run test:catalog` ejecuta pruebas de adaptación, valores nulos, precios,
aislamiento de sede, cambios rápidos, errores y reintentos con Node.
Verificar además en navegador escritorio/móvil: ambos selectores y encabezado
sincronizados, perfil abierto cerrado al cambiar sede, carga/error/vacío,
fotos faltantes y banners editoriales sin cambios. No ejecutar build.
