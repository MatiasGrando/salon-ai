# Reglas de interfaz

- No usar cuadros nativos del navegador (`alert`, `confirm` o `prompt`).
- Toda confirmación, advertencia, error o solicitud de datos debe mostrarse con componentes integrados al diseño visual del CRM.

# Codificación de textos

- Todos los archivos de código y documentación se mantienen en UTF-8.
- En PowerShell, leer archivos de texto con `Get-Content -Encoding utf8`; no reescribirlos usando la codificación predeterminada de PowerShell.
- No incorporar secuencias de texto corruptas como `Ã`, `Â` o `â€`. Antes de cada commit ejecutar `npm run test:text-encoding`.
- En HTML generado dentro de plantillas de JavaScript, usar entidades HTML para caracteres acentuados cuando el texto se inserte mediante `innerHTML` o atributos HTML.
