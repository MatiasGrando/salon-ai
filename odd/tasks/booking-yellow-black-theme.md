# Tema de reservas Amarillo y negro

## Objetivo y autorización
2026-11-03: usuario autoriza implementar una opción seleccionable con nombre exacto «Amarillo y negro», basada en la propuesta vertical aprobada. Al elegirla debe aplicar encabezado amarillo con corte diagonal negro, contenido claro, selección y botones coordinados. El logo SVG o imagen transparente debe verse sobre amarillo. No denominar el tema por un comercio ni cargar otro banner.

Referencia visual: C:/Users/cpu/.codex/generated_images/01a18814-9892-7d01-9ed2-a8e4aeac57bf/exec-245f29f4-aacd-46a9-90f8-334de0614b77.png. Base local d424a63 en codex/barber-initial-intent-recovery; cambios anteriores del bot, reserva y retiro de banner preservados. Autorización local de implementación, sin push, despliegue, cambios reales de configuración o reinicio de servidores.

## Exploración y diseño
La selección bookingTheme ya se guarda por comercio como string. Añadir clave yellow-black a whitelist de business.ts, resolución de landing-ui.ts y radio/preview de crm-ui.ts; no migración ni servicio nuevo. CSS del tema aislado después de overrides existentes, conservando wizard, grillas y funciones. Header compacto amarillo con corte negro decorativo, acciones legibles y alcanzables, sin espacio reservado para banner. Tokens de tinta negra, fondo claro y selección amarilla suave; categorías/checks negros con amarillo y CTA amarillo con negro. Mantener estados de foco y disabled distinguibles.

Logo: aplicar amarillo tanto al contenedor como al elemento img, cuya regla actual fija blanco. Su fondo CSS amarillo opaco cubre las iniciales inferiores y permite transparencia del archivo; no hace falta borrar el fallback ni modificar archivos de imagen. Las imágenes opacas conservarán su fondo propio. Preservar object-fit:contain, nombres largos y Mis turnos/X en móvil, tablet y escritorio.

## Tareas
- [ ] Y1 — Integrar tema seleccionable, validado y persistible por comercio; aplicar tokens, encabezado/diagonal, logo y estados visuales en reserva y preview del selector. Ruta delegated direct: preparación requirió cuatro o más archivos y escritor de tres fuentes no triviales. Criterios: nombre exacto, no cambio de defaults, otras paletas intactas, sin banner ni alteraciones del flujo de reserva.
- [ ] Y2 — Alinear contrato de temas existente y revisar visualmente CSS real con HTML representativo aislado en 390, 768 y 1440 px; comprobar logo transparente/controles/selección y documentar límites. Ruta delegated direct para regresiones y preview; cierre documental mecánico del padre. Guardar evidencia de commits y checks observados.

## Comprobaciones y entrega
Sesión previa registra TDD STRICT; no se encontró configuración distinta específica de UI. Se conserva la restricción previa de no ejecutar flujos/suites, IA/DB, tipos o build ni reiniciar servidores. No afirmar RED/GREEN. Runner existente npm run test:booking-theme-ui importa rutas; se ampliará su contrato sin ejecutarlo. Sí: parseo TypeScript sin importar la aplicación, UTF-8, git diff --check y npm run test:text-encoding antes de cada commit. Preview visual aislado sólo con CSS/markup local, sin JS de reservas, DB ni llamadas de red; no equivale a probar guardado o reservas reales.

Forecast 150–280 líneas authored orientativo, no límite. Entrega local ask-on-risk; feature-branch-chain ya elegida si hiciera falta, sin plan de PR. RDD ON; frontera pendiente b622043, último slice observado 235 líneas bajo presupuesto. Evaluar cada unidad committed-only y usar consentimiento del candidato si llega a corresponder; omisiones anteriores no son consentimiento para este tema. Engram sin herramientas disponibles: espejo odd/booking-yellow-black-theme/tasks pendiente.

## Progreso
Mapa delegado completado y diseño reconciliado por el padre. Documento creado antes de fuentes. Próximo paso: implementar en tres fuentes y actualizar contrato existente, luego preview estático y verificaciones. No cambio de datos reales ni activación del tema en ningún comercio.
