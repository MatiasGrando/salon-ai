# Cuenta y turnos guardados del navegador

## Objetivo y autorización
2026-11-04: implementar la paleta elegida por comercio en /cuenta; mostrar allí los turnos del usuario Google o los accesibles como invitado en este navegador, con invitación a registrarse. Agregar «Ver mis turnos» en la página principal de La Cochera junto a «Reservar turno». Mantener el acceso automático a las reservas guardadas al entrar a /reservar. No ampliar el acceso de invitados ni consultar por teléfono sin autorización. Sin push, DB, flujo de reservas ni reinicio.

Steering adicional: conservar ambas entradas weex.com.ar/lacochera y lacochera.weex.com.ar. El adaptador de portada transforma también /cuenta a /lacochera/cuenta en el dominio central; renderCustomerAccount deriva reservar y volver del basePath recibido. Los accesos de invitado usan el mismo API por slug, independiente del formato de página, en el origen actual.

## Exploración y alcance
renderCustomerAccount omite bodyClass del tema. Su lista y gestor de turnos ya existen. El API guest-booking valida cookies HttpOnly con vigencia de siete días y devuelve sólo las reservas autorizadas; el gestor compartido de cancelación/reprogramación ya acepta esos mismos permisos. Reutilizar ambos, sin nuevo API o backend de autenticación. La portada especial usa published-v13.html y el adaptador de ruta central debe mantener los enlaces locales.

## Tareas
- [x] A1 — Delegated direct: cuenta con tema, turnos de invitados, estados vacío/error y acceso a Google; portada con botón y adaptación de enlace. Trigger: preparación delegada y dos fuentes no triviales más adaptador mecánico. Conserva la cuenta Google y el gestor compartido, cookies y autoentrada existentes; las respuestas asíncronas de invitados se descartan si cambia el usuario. Comprobaciones estáticas PASS; flujo manual pendiente.
- [x] A2 — Inline mecánico: sintaxis, diferencias y codificación PASS. El padre revisó diff y evidencia de rutas. Unidad local preparada para commit; identidad a registrar en el cierre después de observarlo. Verificación visual/funcional pendiente de prueba manual del usuario.

## Comprobaciones y entrega
TDD STRICT heredado del documento booking-yellow-black-theme.md, con restricción explícita persistente de no ejecutar flujos, suites, IA/DB, tipos, build o reinicios. No afirmar RED/GREEN. Runner relacionado existente: npm run test:booking-theme-ui (tsx scripts/booking-theme-ui-contract-test.ts), no ejecutarlo. Permitido: parseo TypeScript sin importar la app, git diff --check, UTF-8 y npm run test:text-encoding antes de cada commit.

Forecast 180–280 líneas authored (adiciones más eliminaciones), orientativo. Estrategia ask-on-risk; feature-branch-chain previamente elegida para cadenas, sin PR solicitado. Base main 695c9b5; rama codex/account-guest-bookings. RDD ON global, evaluación pendiente por el padre después del commit. Engram no disponible: espejo odd/account-guest-bookings/tasks pendiente; este documento conserva el estado local.

## Progreso
Implementación A1 lista: tema y logo del negocio en cuenta, listado de invitados desde guest-booking y gestor compartido de turnos, invitación a Google y regreso al listado. Los botones «Reservar otro turno» usan reservationView=new para no reabrir el turno anterior; la entrada normal a /reservar sigue intacta. Botón nuevo en portada y reescritura central del enlace. No cambios de permisos, datos o duración de cookies.

Evidencia estática: TypeScript parseado sin importar la app y JavaScript inline de /cuenta compilado con new Function sin ejecutarlo, ambos PASS; UTF-8 estricto de fuentes y portada PASS; git diff --check PASS. La portada está marcada -diff/-text en atributos existentes: diff --no-ext-diff --text confirma sólo tres reglas CSS y el grupo de dos enlaces (ocho líneas authored), sin reescribir imágenes/base64. npm run test:text-encoding PASS (exit 0, Text encoding contract OK). Pruebas visuales, Google, invitados, cancelación/reprogramación, build/tipos y flujos no ejecutados por restricción del usuario. Próximo paso: assessment RDD del commit por el padre y prueba manual del usuario; sin reinicio o publicación.
