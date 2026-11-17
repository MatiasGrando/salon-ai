# Caja actual

Alcance autorizado: aplicar la referencia visual a Caja actual y paginar sus movimientos. Mantener importes, filtros, permisos y flujos existentes. Historial de caja, Liquidaciones y Tesorería conservan su diseño. Rama local `codex/instagram-pantalla-principal`, base `8e526f4`. Engram `odd/crm-current-cash-design/tasks` pendiente por herramienta no disponible.

Ruta delegada por mapeo previo de la vista, ruta, cursor y pruebas y por escritura en módulo y regresiones. TDD estricto según `openspec/config.yaml`, runner `node --import tsx`. Estrategia `ask-on-risk`, decisión previa `feature-branch-chain`, previsión de 330–600 líneas y sin PR solicitado. Verificar UTF-8 y diff antes de cada commit. El bloque previo de latencia tiene una decisión de revisión pendiente y conserva su alcance independiente.

- [x] C1. Encabezado y acciones alineados con la referencia, cuatro indicadores con color e iconos, montos legibles, historial de sesiones y movimientos en tablas. Mantener acciones y permisos, accesibilidad y scroll horizontal contenido desde 320 px. Verificar contra la UI renderizada.
- [ ] C2. Paginación de 25 movimientos con Anterior/Siguiente utilizando el cursor existente, página y rango visibles, sin cargar ni acumular todo el día. Respetar jornada, filtros, actividad en tiempo real, cambio de comercio y concurrencia entre solicitudes. Verificar navegación, reintento y restablecimiento ante cambios de contexto.

Las dos tareas se coordinan sobre el mismo módulo. Primero reparar los contratos que detecten el diseño y la paginación faltantes, luego implementar y ejecutar las regresiones. Criterio visual: jerarquía de la referencia, movimientos accesibles en escritorio y móvil y controles legibles con cantidades y textos largos.

C1 RED: el contrato del render no encontró las cuatro tarjetas diferenciadas. GREEN: `node --import tsx scripts/cash-responsive-browser-test.ts --contract-only` cubre el render real, tablas, escape y permisos. Chrome local mediante DevTools probó 320, 390, 768, 1024 y 1440 px con 25 movimientos de ejemplo, importes y controles sin recortes, tablas con scroll contenido y las acciones alineadas en escritorio. Pasó sintaxis CRM. La ejecución por Playwright se reemplazó en este entorno por Chrome local.
