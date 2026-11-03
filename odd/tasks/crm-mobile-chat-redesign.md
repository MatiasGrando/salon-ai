# Chat CRM móvil compacto

## Objetivo y autorización
2026-11-02: usuario solicita mejorar el chat móvil según referencia adjunta. Encabezado de Weex/contacto visible, mensajes protagonistas, fondo suave, barra compacta adjuntar/texto/emoji/enviar, respuestas rápidas y navegación Chats/Conversación/Cliente. Preservar escritorio, funciones reales de envío/adjuntos/ventana WhatsApp, permisos, respuestas rápidas existentes. No inventar atajos ni mensajes configurados. No modificar interpretación del bot.

## Evidencia y jerarquía
Mapa delegado mobile_chat_map por alcance potencial de cuatro o más componentes. Fuente principal src/routes/crm-ui.ts. Defecto observado: bloque móvil cerca de15044 fuerza composer y composer-tools/chat-actions a una columna con !important, apilando cada control y dejando poco espacio para conversación. Reutilizar IDs/handlers y tabs móviles existentes. Jerarquía: barra superior compacta, contacto, historial con scroll propio, accesos reales rápidos/selector, composer horizontal que crece hasta límite, navegación inferior. Teclado reduce el área de mensajes conservando entrada visible; usar visualViewport con reset al salir/desktop. Textarea >=16px para evitar zoom automático.

## Tareas
- [x] M1 — CSS/markup móvil propios para chat, burbujas, encabezado, composer compacto y tabs accesibles. Ruta delegated direct: preparación delegada y writer de una fuente compleja. Implementado y revisado estáticamente; aceptación visual pendiente.
- [x] M2 — Altura de viewport/teclado y textarea limitada, preservar estado/selección y envío/adjuntos. Ruta delegated direct, mismo writer exclusivo crm-ui.ts para evitar solapamientos. Implementado visualViewport/resize/focus y hooks de inserción/envío, pendiente teclado físico real.
- [ ] M3 — Revisión estática sintaxis TS/JS embebido, UTF-8, responsive y reinicio sólo instancia local3000 propia si necesario; documentar pruebas visuales pendientes. Ruta inline padre.

## Restricciones y checks
Preservar cambios ajenos y funciones desktop/tablet. No enviar mensajes, reservar turnos ni alterar datos operativos. Sin pruebas sintéticas de flujo por restricción vigente del usuario, sin DB/modelos/build/typecheck/commits/revisión externa. TDD strict heredado de sesión con ejecución de suites omitida explícitamente; no RED/GREEN inventados. Sintaxis TS y JavaScript generado, UTF-8/diff; si navegador disponible comprobar móvil con/sin teclado, ancho320/390, tablet768 y escritorio1280. Navegador IAB falló en tarea previa, reportar visual pendiente si persiste. Servidor local3000 autorizado por usuario; launcher booking-visual-local-3000.ts, sesión79733 propia, sin workers/sender.

Forecast150–300 líneas authored orientativo, estrategia single-pr sin crear PR/commits. Engram no disponible: espejo odd/crm-mobile-chat-redesign/tasks pendiente. Documento local fuente de recuperación.

## Progreso
Writer mobile_chat_writer completó crm-ui.ts:147 adiciones/5 eliminaciones. CSS final max767 y ámbito conversations, composer grid horizontal propio, botón rápido compacto, tabs existentes con iconos, burbujas/fondo; ajustes se retiran al pasar a escritorio. Textarea44–112, resize tras input/respuesta rápida/envío; viewport usa resize/scroll/focus, no confunde pinch zoom con teclado, oculta tabs durante teclado. No agregó handlers de emoji/adjuntos inexistentes previamente: es alcance visual.

Verificación padre: TS parse sin errores, UTF-8/texto corrupto correctos y diff-check correcto. Se reinició sólo la instancia propia3000 (sesión79733 detenida y reemplazada81021) con escalación aprobada, mismo launcher aislado sin workers/sender. HTTP /crm200; los dos scripts del HTML real servido parseados con vm.Script sin ejecutarlos, syntaxErrors=[]; nuevos estilos/viewport/composer presentes. Se resolvió la duda de extracción artificial del writer verificando HTML real. No se enviaron mensajes ni se ejecutaron suites, tipos, compilación, modelos, DB de diagnóstico, commits o revisión externa.

V3 visual pendiente: navegador IAB disponible pero /crm está en login, sin sesión autenticada; no se tomaron credenciales ni se eludió autenticación. Comprobar manualmente 320/390, teclado abierto/cerrado, multilinea, respuestas rápidas y cambio desktop/tablet. Local listo en http://localhost:3000/crm. Engram sigue pendiente por herramientas no disponibles.
