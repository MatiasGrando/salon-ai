# Reglas de interfaz

- En TODO formulario redimensionable, agrandar el cuadro debe agrandar también su contenido: campos, textos, títulos, botones, filas y espaciados. No alcanza con estirar el contenedor ni dejar controles con tamaños fijos. El escalado debe responder al ancho O al alto, conservar el tamaño elegido y respetar el viewport móvil. Antes de darlo por terminado, verificar tamaño inicial, ampliación horizontal, vertical y combinada, reapertura y móvil; incluir una prueba de regresión del escalado interior.

- No usar cuadros nativos del navegador (`alert`, `confirm` o `prompt`).
- Toda confirmación, advertencia, error o solicitud de datos debe mostrarse con componentes integrados al diseño visual del CRM.
- Antes de implementar un formulario, definir y verificar su jerarquía visual completa: encabezado, secciones agrupadas, espaciado interior, grilla responsive, estados de foco/error, acciones fijas y prueba visual en resoluciones de escritorio y móvil.
- Ningún formulario nuevo puede reutilizar clases genéricas sin agregar un contenedor visual propio que garantice padding, ancho, alineación y desborde correctos.
- Los listados operativos con varios registros deben priorizar tablas simples, escaneables y responsivas sobre tarjetas, salvo que el usuario pida explícitamente otro formato.

# Codificación de textos

- Todos los archivos de código y documentación se mantienen en UTF-8.
- En PowerShell, leer archivos de texto con `Get-Content -Encoding utf8`; no reescribirlos usando la codificación predeterminada de PowerShell.
- No incorporar secuencias de texto corruptas como `Ã`, `Â` o `â€`. Antes de cada commit ejecutar `npm run test:text-encoding`.
- En HTML generado dentro de plantillas de JavaScript, usar entidades HTML para caracteres acentuados cuando el texto se inserte mediante `innerHTML` o atributos HTML.
