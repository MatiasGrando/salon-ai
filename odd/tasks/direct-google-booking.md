# Acceso directo con Google en reservas

El botón de Google de **Tus datos** inicia el mismo acceso que el botón de Google del cuadro de autenticación, con su diseño multicolor y sin un clic intermedio. El alcance es la página pública de reservas. El acceso general a Mi cuenta conserva su navegación. Mantener la selección del turno, el retorno validado, el modo Calendar y la compatibilidad con las direcciones que requieren el acceso central de Weex.

- [ ] DGB-1 — Montar el acceso de Google en ambos lugares de la página y comprobar el flujo con el proveedor simulado. Ruta delegada por preparación y edición no trivial en la vista pública y su contrato. RED por el clic que abre el cuadro. GREEN en el acceso directo, retorno al borrador, comportamiento sin proveedor y navegación general.

Rama `codex/direct-google-booking` basada en `main` local. TDD estricto de `openspec/config.yaml` (`strict_tdd: true`), runner `node node_modules/tsx/dist/cli.mjs scripts/booking-google-sign-in-ui-test.ts`. El contrato anterior de interfaz de invitado ya tiene fallos ajenos al cambio en la base. Verificar el nuevo contrato acotado, retorno desde Google, sintaxis, `npm run test:text-encoding` y diff. Sin autenticación real. RDD según el control vigente. Entrega `single-pr` si se autoriza más adelante. Estimación de 250–350 líneas de autoría.

Espejo de este documento en Engram `odd/direct-google-booking/tasks` para `salon-ai`.

Prueba focalizada GREEN con Google simulado. Incluye acceso con un clic, Calendar, inicialización única, reapertura, error en el lugar del botón, retorno al borrador, teléfono faltante y navegación de cuenta. El contrato general de interfaz de invitado y el anterior de retorno tienen expectativas desactualizadas verificadas en `895a6ca`. Se conserva el acceso central en direcciones antiguas donde se requiere.
