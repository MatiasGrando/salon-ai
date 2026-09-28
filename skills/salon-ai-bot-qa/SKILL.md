---
name: salon-ai-bot-qa
description: Project-specific QA and regression checklist for Salon AI/Cami WhatsApp booking flow. Use whenever Codex changes booking conversation code, WhatsApp replies, OpenAI/orchestrator behavior, availability logic, confirmation/cancellation/editing flows, or bot tone, so previously fixed Cami errors do not reappear.
---

# Salon AI Bot QA

Use this skill before and after changing Cami's WhatsApp booking flow.

## Core Rule

Cami can sound human, but the backend must stay strict. Never let AI invent or silently choose booking-critical data.

Critical data:
- customer name
- service
- date
- professional
- time
- confirmation/cancellation intent

Do not capture a customer name from a greeting plus a loose name, such as `Hola Manola`. That may be the user greeting Cami with the wrong name or testing whether they remember the bot. Only capture a name when the user gives a clear identity signal, such as `soy Manola`, `me llamo Manola`, or `mi nombre es Manola`, or when they provide a plain name without greeting while Cami is explicitly asking for the name.

If the user writes something like `Hola Manu quiero un turno`, treat `Manu` as a wrong name for the bot, not as the customer name. Cami should clarify that she is Cami. If the customer name is unknown, ask for it again. If the customer name is already saved, continue the booking flow from the user's intent.

## Required Flow Order

For a normal booking, preserve this order unless the user explicitly provides later data:

1. Service
2. Date
3. Professional
4. Time
5. Confirmation

Do not show availability before service and date are known.
Do not choose a professional unless the user named one or explicitly accepted any professional.

Allowed exception: if the user asks broadly for availability, such as "hay turnos para hoy" or "que horarios tienen", Cami may show broad availability only after service and date are clear.

Allowed preliminary exception: if the customer asks whether a named professional has space on a clear date, Cami may show reference availability before the service is known. It must explain that the definitive options depend on the service, ask whether the customer wants to reserve with Yes/No buttons, and persist the professional, date, and lower time boundary. If accepted, ask for name and service without asking for those saved preferences again, then recalculate real availability for the selected service before offering a concrete booking time. A rejection returns to the existing "¿Te puedo ayudar en algo más?" flow.

## Do Not Repeat These Regressions

### CRM Bot Toggle

The business-level bot toggle is different from the AI toggle.

- `botEnabled = false`: save inbound WhatsApp messages in the CRM, but do not send any automatic reply.
- `aiEnabled = false`: the bot may still respond with the non-AI/basic flow.

Do not hide the full bot toggle behind an "IA" label in the CRM.

### Confirmation

In `CONFIRM`, detect confirmation before trying to interpret service/professional changes.

Treat as confirmation:
- confirmar
- confirmo
- si confirmar
- si confirmo
- confirmalo
- dale
- listo
- perfecto
- ok
- okey
- quedamos asi
- asi esta bien

If the message is a confirmation, create the appointment. Do not ask if the user wants to change professional or service.

### Professional Selection

Do not infer a professional from a date-only message.

When the professional step shows exactly one compatible professional and asks
whether the customer wants to book with that person, a literal affirmative
reply such as `si`, `sí`, `dale` or `perfecto` must select that professional and
advance. If more than one compatible professional is shown, a bare affirmative
must not silently choose one.

Bad:
User: "para hoy si es posible"
Cami: "te busco con Agustin"

Correct:
Cami asks which professional, unless the user said "cualquier profesional", "cualquiera", "me da igual", or equivalent.

If user rejects the inferred professional, e.g. "nunca te dije Agustin", clear `selectedProfessionalId` and ask again.

### Date Selection

Do not invent dates.

Only accept a date if the user gave a clear date signal:
- hoy
- manana
- mañana
- pasado
- weekday name
- DD/MM/YY
- DD-MM-YY
- DD/MM/YYYY
- DD-MM-YYYY

Do not treat ordinary numbers as dates outside the date step unless the current step clearly expects date options.

Display dates for Argentina as `DD/MM/YYYY`.

### Time Selection

Do not show past times for today.

Understand:
- `5` means `17:00` when context says afternoon/evening or business hours imply it
- `5pm` means `17:00`
- `despues de las 3` means slots after `15:00`
- `a la tarde` means afternoon preference, not a concrete hour

If user says "el de las 5" and `17:00` exists, select it.

### Low Confidence

If Cami is unsure, ask a clarification question with concrete options.

Good:
"No me quedo claro. Queres confirmar el turno o cambiar algo?"

Bad:
Restarting the whole flow or repeating all previous menu text.

### Post-Booking Closing

After an appointment is confirmed, do not show the main menu just because the user says thanks or closes the conversation.

Bad:
User: "dale excelente"
Cami: main menu with reservar/ver/cancelar/cambiar.

Correct:
Cami gives a short warm closing and stays available.

Only start a new booking/menu flow after confirmation if the user explicitly asks for another booking, appointments, cancellation, edit, or reset.

If the user greets again after a confirmed booking, such as "hola", "hola como estas", or "buenas", reopen the conversation warmly. Do not ask for the name again if it is already known.

### Expired Flows

If a user leaves an unfinished flow and returns after 24 hours, reset the flow to the beginning. Do not continue from stale service/date/professional/time data.

Completed conversations are different: do not reset only because time passed. If the user greets again after a completed booking, reopen warmly.

### Cancellation Closing

After canceling an appointment, Cami should confirm the cancellation and ask if the user needs anything else or wants to book another appointment.

Bad:
`Listo, cancele tu turno...`

Correct:
`Listo, cancele tu turno... Te puedo ayudar con algo mas o queres que busquemos otro turno?`

### Appointment Lists

"Mis turnos", cancellation lists, and edit lists must show only future active appointments. Never show appointments whose `startAt` is already in the past.

When the bot asks the user to choose an appointment from a list, accept natural numeric replies:
- `7`
- `el 7`
- `numero 7`
- `quiero cancelar el numero 7`
- `7. Corte Hombre`

Use the same filtered appointment list for display and for selecting/canceling/editing, so the visible numbers match the action.

If the bot cannot understand which appointment the user selected, explain what was unclear and give a concrete example. Do not only repeat the same list.

Good:
"No llegue a entender que turno queres cancelar. Respondeme con el numero de la lista, por ejemplo: 1, el 1 o cancelar el numero 1."

If the user is choosing from a cancellation/edit list and says "volver a empezar", "empezar de nuevo", or "reset", stop waiting for the list selection and reset to a clean booking/menu state. Do not treat those messages as invalid appointment selections.

Handle common typos for high-intent appointment actions:
- `kiero cancelar`
- `kiero canselar`
- `camviar turno`
- `kiero camviar`

When multiple future appointments are listed, selecting `el 2` must affect the second visible item, not the first or a hidden/past item.

### Late-Day Availability

If the user asks for today when all remaining business/professional hours are already in the past, do not show past slots. Explain that no slots are available for today and offer useful alternatives such as another day, another professional, or no preference.

When service and date are known but no professional has been selected yet, check whether any professional has availability for that date before asking the user to choose a professional. If nobody is available that day, explain that there are no slots and offer alternatives instead of continuing to the professional step.

If the user chooses "buscar horarios para hoy con todos los profesionales" and no slots exist, keep the flow ready to choose another date. If they then say "otro dia" or "probamos otro dia", ask for the date again.

### Off-Flow Or Flirty Messages

If user says things like "sos linda", "salimos?", "queres una cena", answer warmly but return to the booking flow.

Do not flirt back. Do not break character. Do not reset unless user asks reset.

When a human handoff is resolved from the CRM, clear stale booking-critical state before returning control to Cami: selected service, selected professional, selected date, selected time, and cached availability. After a resolved handoff, a new "hola" or "reservar turno" must not reuse the service/professional/date/time from before the handoff.

If the user asks for something outside the salon context while Cami is waiting for a service, such as "quiero una cancha", "tenes cambio?" or unrelated errands, do not select a salon service by guessing. First clarify that Cami helps with salon appointments and show service options. If the user still does not clarify, show recovery options such as "cambiar servicio", "volver al paso anterior" or "pasarte con una persona".

If the user says "no quiero nada", "nada gracias" or equivalent while a booking is in progress, stop the booking politely and return to a clean `START` state. Do not keep repeating availability.

If the user provides service + date + time but no professional, do not choose a professional automatically and do not confirm the appointment. Ask for the professional or "cualquier profesional". Keep the requested time so it can be used after the professional is selected.

### Booking V2 Informational Interruptions

Every Booking V2 message must pass through the conversation router, even while a booking is in progress.

At `START`, questions such as `hoy te quedó algún turno disponible a la tarde?` are booking availability requests, not opening-hours questions. Appointment words such as `turno`, `lugar`, `espacio` or `hueco` combined with availability language must take priority over `opening_hours`. Once that flow has started, a short follow-up such as `¿o mañana?` must update the requested date while preserving the pending booking and asking only for the next missing field.

If the customer asks about business information such as opening hours, address, website, booking link, phone, email, Instagram, Facebook, services, or prices:

- answer only with data loaded from the current business;
- never invent a missing value;
- preserve all booking-critical state and any pending proposal;
- repeat only the next pending booking question after the informational answer;
- support mixed messages, such as `a que hora abren y quiero un corte manana`, by answering the question and applying only validated booking data;
- continue with deterministic business-information detection if OpenAI fails.
- classify only the current inbound message; never repeat an informational intent from conversation history when the new message does not contain it.

Regression sequence:

1. User asks `Tenes pagina web?` and Cami answers it.
2. User later says `Hola` while the booking is still active.
3. Cami must greet or resume the pending booking question without repeating the website answer.

Natural catalog questions such as `Cuales servicios hay?`, `Que servicios hay?` and `Mostrame los servicios` must render the real service catalog and then resume the pending booking step.

Whenever Booking V2 asks the customer to choose, show the real available options instead of an empty question:
- service: list the business services with duration and price, or `precio a consultar`;
- professional: list only active professionals compatible with the selected service, plus `Cualquier profesional`;
- time: list real availability as `hora con profesional` so the customer knows who would attend them.

Questions such as `Quienes atienden?`, `Que profesionales hay?` and `Con quien me puedo atender?` must answer from the business professional catalog and mention the services assigned to each professional when available.

When the pending field is `professional`, an exact match with a compatible catalog professional must be accepted deterministically before AI extraction. It must never overwrite or propose changing the customer's name. Pending proposal confirmations (`si`/`no`) must always be evaluated from the literal current customer message, never from a router rewrite.

After confirming a proposed service or professional, Booking V2 must keep the loaded catalog when rendering the next question so the customer immediately sees the compatible options.

Common exact selections must avoid redundant field confirmations:
- accept equivalent service labels regardless of conjunction order, such as `Color y corte` for `Corte y color`;
- accept `hoy` and `mañana` deterministically in the business timezone;
- accept a typed time only when that time exists in the current real availability.

Never ask the customer to choose a time on a date with no availability. Clear that date, explain that no slots exist, and ask for another date. Never reach final confirmation with a time that was not returned by the availability provider.

`Cualquier profesional`, `cualquiera` and `sin preferencia` are valid Booking V2 selections. Keep the flow moving without forcing another professional question; when the customer chooses an available time, bind the booking to the real professional attached to that slot before final confirmation.

Never classify a value for a still-empty field as a correction. If a partial service answer matches multiple catalog entries (for example `Corte` matching `Corte Hombre` and `Corte y color`), show only those matching options and ask the customer to disambiguate; do not ask whether they want to modify the service.

Never truncate availability silently. Booking V2 must show every returned slot, grouped compactly by professional, and explicitly state that the displayed list contains all available times.

Compact time answers such as `1830` and `930` must resolve to `18:30` and `09:30`. If a customer uses a 12-hour expression such as `a las 6`, match it against real availability and use `18:00` when `06:00` is unavailable. A bare time must never be treated as a date correction.

At final confirmation, phrases such as `quiero cambiar la hora` or `quiero cambiar el horario` must clear only the selected time and immediately show the real availability again instead of repeating the final confirmation.

Booking V2 extraction must receive `expectedField` explicitly. The model may use it to resolve ambiguity, but the backend remains responsible for catalog and availability validation.

Booking V2 conversational copy may add at most one short social prefix around the deterministic reply. The required reply must remain verbatim. Reject AI prefixes containing questions, numbers, URLs, prices, dates, times, availability claims, service/professional claims, or confirmation claims; fall back to the deterministic reply unchanged.

Assistant personality is configured per business, not per conversation. It may control assistant name, role, preset, `vos`/`tú`/`usted`, emoji level, preferred emojis, response length and additional style instructions. It must never override booking facts, validation or confirmation rules. The `none` emoji level must also remove emojis from deterministic Booking V2 copy.

### Conversational runtime integration

When the versioned conversational engine is enabled for the test business, process each admitted message through the existing inbox and outbox. Preserve the validated draft across messages. A revision or configuration change must retry the same durable text without publishing an old reply; a human-owned or bot-disabled conversation must not send a reply, including an expiry or configuration-change greeting. Old prompt buttons must not execute legacy actions under the conversational marker. A cutover recovery must create a durable inbox job for the conversational worker. Do not treat a booking proposal as an actual booking.

### Tone

Cami should stay warm, attentive, feminine, and professional across all messages, not only the first one.

Preferred style:
- short WhatsApp-friendly messages
- natural warmth
- light emojis where helpful
- no robotic repetition
- no overexplaining

Avoid:
- repeated "Perfecto" on consecutive lines
- long forms
- sounding like an API response
- too many menus when a simple clarification is enough

## QA Checklist Before Finishing Changes

Run typecheck:

```bash
npx tsc --noEmit
```

Mentally test these conversations:

1. User: "hola soy matias quiero cortarme el pelo hoy"
   Expected: capture name + service + date, then ask professional.

2. User at confirmation: "okey perfecto quedamos asi"
   Expected: appointment is created.

3. User at confirmation: "confirmar"
   Expected: appointment is created.

4. User at date step: "para hoy si es posible"
   Expected: does not invent professional; asks professional unless any-professional was already selected.

5. User: "cualquier profesional"
   Expected: accepted as no specific professional.

6. User: "nunca te dije Agustin"
   Expected: clear professional and ask again.

7. User: "quiero una cena con vos"
   Expected: warm redirect back to booking options.

8. User: "25/6/26"
   Expected: parse as `25/06/2026`, display as `25/06/2026`.

9. User: "manana despues de las 3"
   Expected: date tomorrow, slots after `15:00`.

10. User: "el de las 5"
    Expected: select `17:00` when available.

## Conversational QA preview regression

- The new conversational preview is an explicit opt-in mode of Administración → Demos comerciales → Simular conversación, visible only for SUPER_ADMIN on QA_SANDBOX profiles. Default to the existing mode; switching modes resets the local test session.
- Preview messages may persist only as separate QA test-chat history. Never call the fake Meta webhook, production outbox, booking mutations or CRM event publishing from this mode. AI is allowed only under the explicit QA preview opt-in described below.
- Preserve state across rapid/concurrent turns in one preview session using the QA-only locked row and supportBotState; a new conversation resets it. Show interpreted fields and separated load/context/engine/persist/total times, not an invented end-to-end WhatsApp latency.
- A proposal is not a reservation. Keep the preview label explicit that no booking or WhatsApp send occurs.
- In the QA conversational preview only, keep the composer usable while a reply is pending. Queue rapid customer turns in order, persist each turn, and suppress intermediate bot replies when a newer customer turn arrived before display. A failed turn must be visible and must not strand later turns. A new session, profile, or mode must discard old queued UI work and never render its late reply in the new chat. This does not implement production WhatsApp message coalescing.

## Where To Look

Main files:
- `src/services/booking-conversation-flow.ts`
- `src/services/conversation-service.ts`
- `src/services/message-understanding-service.ts`
- `src/services/ai-message-understanding-service.ts`
- `src/services/bot-copy-service.ts`

If behavior changes, update this skill with the new regression rule before ending the task.

### Early professional preference in the new conversational engine

When a customer explicitly says `con <professional>` before identifying a service or date, retain that name only as an unverified hint across turns. Do not create a professional ID from the text. Once service and date are known, resolve the hint only if exactly one compatible professional matches the actual availability catalog. If several match or none is compatible, ask for clarification rather than silently selecting another professional. Preserve the hint across service selection, clear it after resolution, on reset/rejection, on `cualquier profesional`, or when an explicit new preference replaces it. Older version-1 draft snapshots without this field must remain readable. Regression: `hola queria` → `un turno con ramiro mañana` → `corte hombnre` → `corte hombre` must not ask for Ramiro again when he is uniquely compatible. The misspelled service itself remains unselected until clarified; do not guess it.

### QA preview preparation lock boundary

For the QA conversational preview, read the saved version and prepare the full response (including any slow interpreter, catalog, or availability query) before opening the row-lock transaction. Under the lock, compare the state owner and complete saved snapshot; persist exactly one inbound/outbound pair and the new state only if unchanged. On a conflict, re-read and recompute the same inbound within a bounded retry count. Failed preparation or exhausted conflicts must never persist that inbound. Within one server process, rapid turns in the same session retain invocation order; across workers, commit ordering is only guaranteed by the version check, not by original network-arrival order. This is not the productive WhatsApp C04 consolidation.

### AI-first interpretation in the QA conversational preview (opt-in)

- Keep the existing preview deterministic unless the QA caller explicitly injects the interpreter. Do not change the old bot's global model or enable AI for a production profile by default.
- Once enabled, interpret every QA turn with the structured provider; mark `ai` versus `fallback` explicitly and record provider, validation and total timings. A timeout, provider error or invalid output must fall back to the deterministic engine without losing saved booking context.
- The model's service ID must exist in the current tenant's catalog and its evidence must appear in the customer's current message. A typo such as `corte hombnre` can prompt `¿Te referís a Corte Hombre?` but cannot select that service. Preserve an independently stated date and professional hint while clarifying.
- A professional mention must be a whole-word literal in the current message (not a substring of another name), and negated or self-identity mentions must not be promoted to a preference. Store it only as an unverified hint until the real availability catalog confirms unique compatibility. Never use AI-generated IDs, dates, prices, slots or booking confirmations as factual authority.
- Preview/core tests use fake providers only. A real OpenAI request with a QA customer's text and an API credential needs separately explicit remote authorization.

## QA Conversational Preview AI Regression

- The new interpreter is opt-in only for SUPER_ADMIN + QA_SANDBOX preview. `CONVERSATIONAL_QA_AI_ENABLED` defaults off and must not affect Booking V2, normal demo, Meta, or existing `OPENAI_MODEL`.
- Enabled preview invokes AI on each turn, then validates service/professional evidence against the actual message and tenant catalog. A typo is a suggestion, never an automatic booking-critical selection.
- Disabled, failed, timed-out, or invalid AI output must show deterministic/fallback mode and safe reason/timings. Do not persist credentials, raw prompt, model output, or exception text in diagnostic metadata.
- No AI interpretation alone creates a reservation or sends WhatsApp. Preview replies are still produced from validated deterministic facts; do not call this free-form generative conversation.
- QA-only AI timeout defaults to 4500 ms and is configurable from 1000 to 5000 ms; keep a regression where a fake provider resolving after 3500 ms is recorded as AI, not timeout fallback. Real model latency still needs operational measurement.

### QA AI conversational copy (single-call experiment)

- The opt-in QA provider returns interpretation and `replyDraft` in one structured Responses call per turn. Do not add a second serial prose call to the QA latency path without measuring it.
- The local engine always computes and owns booking state, catalog values, availability, and proposal. AI text may replace only a simple pending service/date/name question when it asks for that same field and contains no business fact, or add a short, validated social lead before canonical factual text. Prices, `Desde`, real slots and proposal facts remain verbatim. Invalid/missing drafts use canonical copy and display copy fallback separately from interpretation mode.
- A simple greeting draft without a question, such as `¡Hola! Todo bien, gracias.`, may be used only after safe-copy validation and must receive the canonical service question once. Never duplicate a question or drop factual information requests.
- QA `gpt-6-luna` requests use `reasoning.effort: none` as an initial latency experiment; this is not a quality/p95 conclusion. Other explicitly configured QA models do not inherit this setting blindly.
- A literal misspelled service evidence with null service ID is valid AI interpretation. A unique near-match can prompt a confirmation question, but never silently select the service. `quiero un corte de hombnre` must not produce `invalid_output` or a full service dump.
- Regression: `hola como estas` can receive a short model-written service question without a catalog dump; a service-selection turn can receive a short model-written date question; factual price/slot replies retain their canonical data; attempted invented prices, times or bookings are rejected. Show both interpretation and copy modes in the QA chat. No production WhatsApp/reservation effects or automatic learning.
