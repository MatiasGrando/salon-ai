---
name: agregar-tool
description: Dale a tu chatbot una capacidad nueva (una "tool") describiéndola en español, sin programar. Claude usa una tool que ya existe como molde, escribe la nueva, la conecta, corre las pruebas y te reporta. Actívalo con "/agregar-tool", "quiero que mi bot pueda X", "que revise el estatus de un pedido", "agrégale una capacidad", "que consulte Y", "que haga Z", "nueva herramienta para mi bot".
---

# Agregar Tool — dale una capacidad nueva a tu bot

Eres el ingeniero del chatbot del miembro. Él NO programa: **tú escribes el código y corres
los comandos**. Él te dice en español qué quiere que su bot pueda hacer (ej. "que revise el
estatus de un pedido por número de orden"), y tú lo conviertes en una **tool** real, la
conectas, la pruebas y le entregas el resultado. El protagonista de lo que muestres es la
**capacidad nueva** ("ahora tu bot puede revisar pedidos"), nunca el código.

Una "tool" = una acción que el bot puede ejecutar por sí solo (buscar en su base, capturar un
lead, agendar, consultar algo). Sin tools, el bot solo platica; con tools, hace cosas.

SIGUE ESTAS REGLAS AL PIE DE LA LETRA.

## PASO 0 — Revisión (no edites nada todavía)
1. Confirma que estás en la carpeta del bot: debe existir `package.json` con los scripts
   `test` y `typecheck`, y la carpeta `src/tools/`. Si no, detente y dilo.
2. **LEE qué tools ya existen** listando `src/tools/` y abriendo `src/tools/index.ts`. Esto te
   dice qué tiene este bot. Todos los bots (incluido Starter) ya traen `searchKb`,
   `handoffHuman`, `pauseBot`, `snoozeUser` y `captureLead`. Los bots Pro además traen
   `scheduleAppointment` y `catalogQuery`, y soportan más canales (matriz completa en
   `skill/references/starter-vs-forja-plus.md`). **No asumas: adáptate a lo que EXISTE en
   runtime.**
3. Punto de seguridad: corre `git status` (avisa si hay cambios sin guardar) y anota el commit
   actual con `git rev-parse --short HEAD` por si hay que volver.
4. Cuéntale en 2-3 líneas qué tools ya tiene y espera su "ok".

## PASO 1 — Entiende la capacidad que pide
Pregúntale en lenguaje de negocio qué quiere que el bot pueda hacer. Confirma con él:
- **Qué hace** la capacidad en una frase (ej. "consultar el estatus de un pedido").
- **Qué datos necesita** del cliente para hacerlo (ej. "número de orden"). Estos serán los
  campos del `inputSchema`.
- **De dónde sale la respuesta**. Esto es CLAVE. Tres casos:
  - **(A) Datos que ya viven en el bot** (su base de datos D1, su catálogo, su KB) → lo puedes
    hacer tú solo.
  - **(B) Lógica simple** (un cálculo, una regla, una lista fija) → lo puedes hacer tú solo.
  - **(C) Un servicio EXTERNO** (su sistema de pedidos, un API, Google Sheets, un CRM) →
    **requiere integración + posiblemente un secret/llave**. Aquí **PIDE CONFIRMACIÓN** antes de
    seguir (ver Paso 2-bis).
No inventes de dónde salen los datos. Si no te queda claro, pregunta.

## PASO 2 — Usa una tool existente como molde
**LEE** una tool que se parezca a lo que quieres, para copiar el patrón exacto del repo
(no inventes la forma):
- Si lee de una lista/catálogo en memoria → molde `src/tools/catalogQuery.ts`.
- Si lee/escribe en la base de datos D1 → molde `src/tools/captureLead.ts` (usa `Db` + repos
  de `src/db/`).
- Si busca en el knowledge base → molde `src/tools/searchKb.ts`.
- Si llama a un API externo → molde `src/tools/scheduleAppointment.ts` (usa `fetch`, lee la
  llave de `env`, y devuelve `{ error: "..._not_configured" }` si falta).
Toda tool tiene la misma forma:
```ts
import { tool } from "ai";
import { z } from "zod";
import type { Env } from "../env";

export function miToolNueva(env: Env) {
  return tool({
    description: "Frase clara para el modelo: qué hace y cuándo usarla.",
    inputSchema: z.object({
      campo: z.string().describe("qué es este dato"),
    }),
    execute: async ({ campo }) => {
      // lógica aquí
      return { /* resultado */ };
    },
  });
}
```
Reglas del molde:
- La **`description` es lo más importante**: el modelo decide usar la tool leyéndola. Sé
  específico ("Consulta el estatus de un pedido por número de orden. Úsala cuando el cliente
  pregunte por su pedido/envío.").
- El **`inputSchema`** en Zod, con `.describe()` en cada campo, y `.optional()` en lo que no
  sea obligatorio.
- Si la tool **puede fallar** (API externo, datos faltantes), devuelve un objeto de error
  controlado (`{ error: "...", message: "..." }`), igual que `scheduleAppointment` —
  nunca dejes que truene.
- Si necesita la base de datos, importa `Db` de `src/db/client.ts` (`new Db(env.DB)`) y, si hay
  un repo apropiado en `src/db/`, úsalo.

### PASO 2-bis — Si requiere integración externa o secret (caso C)
**DETENTE y pide confirmación antes de escribir código.** Explícale en español:
- Qué servicio externo se va a conectar.
- Qué **llave/secret** hace falta (ej. una API key de su sistema de pedidos).
- Que esa llave se guarda como variable de entorno (en `.dev.vars` para local y con
  `wrangler secret put NOMBRE` para producción) — **nunca** pegada en el código ni en el chat.
Solo cuando él diga "ok" y tengas claro de dónde sale la llave, continúa. La tool debe leer la
llave de `env` y devolver `{ error: "X_not_configured" }` si no está, como
`scheduleAppointment`.

## PASO 3 — Escribe la tool nueva
Crea `src/tools/<nombreCamelCase>.ts` siguiendo el molde. Antes de crear el archivo, dile en
una línea qué vas a crear (no necesitas su permiso para crear un archivo nuevo, pero sí avísale).

## PASO 4 — Conéctala (registro) — PIDE CONFIRMACIÓN, esto toca `src/`
Tocar `src/` requiere su "ok". Avísale qué vas a cambiar y hazlo:
1. **Regístrala en `src/tools/index.ts`**: importa la función arriba y agrégala dentro de
   `buildTools`. Decide el tier:
   - Si es una capacidad básica → ponla en el set base (junto a `searchKb`/`handoffHuman`/`pauseBot`).
   - Si es una capacidad avanzada y el bot es Pro → ponla dentro del bloque `if (isPro(ctx.env))`.
2. **El gate REAL es dónde la pones dentro de `buildTools`** (dentro o fuera del
   `if (isPro(ctx.env))`) — eso es lo que de verdad la activa o no en runtime. Si además
   quieres documentarla como Pro-only, agrégala al arreglo `PRO_ONLY_TOOLS` en `src/config.ts`,
   pero ese arreglo es solo documental: no tiene consumidores en runtime (`isToolAvailable` no
   se llama desde ningún lado), así que **NO** sustituye el paso anterior (ver
   `skill/references/mapa-forja.md` §5).
3. **La lista de tools del system prompt se llena sola** a partir de las tools registradas
   (en `src/agent.ts` el prompt recibe `Object.keys(tools)`), así que con registrarla ya
   aparece en `<tools>`. **Pero** si la capacidad necesita una instrucción de comportamiento
   (ej. "siempre pide el número de orden antes de consultar", "no inventes estatus, usa la
   tool"), añade esa regla en `member/system-prompt.local.ts` (el override del cliente) — **no**
   edites `src/system-prompt.ts`. Cualquier cambio al system prompt: avísale primero.

## PASO 5 — Escribe su prueba
Crea `test/tools/<nombre>.test.ts` usando como molde `test/tools/catalogQuery.test.ts`
(prueba un caso que sí encuentra/funciona y un caso vacío/de error). Si la registraste como
Pro, **actualiza también** `test/tools/index.test.ts` para que el conteo de tools por tier
siga cuadrando (ese test lista exactamente qué tools tiene cada tier).

## PASO 6 — Verifica que nada se rompió
Corre, en este orden:
1. `pnpm typecheck` — que no haya errores de tipos.
2. `pnpm test` — que pasen TODAS las pruebas (las cientos que ya existían + la tuya).
Si algo falla: arréglalo (una cosa a la vez) y vuelve a correr. Si un arreglo te obliga a
tocar más `src/`, avísale antes. No marques "listo" hasta que ambos comandos pasen limpios.

## PASO 7 — Reporte final (en lenguaje de negocio)
- **Capacidad nueva**: "Ahora tu bot puede ___" (en una frase, lo que él pidió).
- **Qué datos pide** para hacerlo (los campos).
- **Qué archivos toqué**: 1 línea por archivo (tool nueva, registro, prueba, y prompt si
  aplica).
- **Pruebas**: `pnpm typecheck` ✓ y `pnpm test` ✓ (X de Y).
- **Pendiente / lo que necesito de ti**: si requiere una llave externa que aún no me diste, o
  datos que solo tú tienes.

## Reglas de seguridad (no las rompas)
- **PIDE CONFIRMACIÓN** antes de: tocar cualquier cosa en `src/` (registro/config), editar
  `member/system-prompt.local.ts`, instalar dependencias, o conectar un servicio externo/secret.
  Crear un archivo de tool NUEVO y su test no requiere permiso, pero avísale qué creaste.
- **NUNCA** pegues secrets/API keys en el chat ni los escribas en el código. Van en `.dev.vars`
  (local) y `wrangler secret put` (producción).
- **NUNCA** hagas `deploy` ni `git push` ni commits por tu cuenta.
- **Recuérdale al final**: la capacidad ya está en el código y probada, pero para que el bot
  EN VIVO la tenga, hay que **desplegar** (`pnpm run deploy`) — eso lo decide y lo corre él (o tú
  solo si él te lo pide explícitamente). Si la tool consulta su base de datos en producción,
  recuérdale que las consultas de D1 se hacen con
  `wrangler d1 execute DB --command "..." --remote`.

Empieza por el PASO 0.
