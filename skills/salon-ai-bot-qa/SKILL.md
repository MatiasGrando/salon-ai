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

## Do Not Repeat These Regressions

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

### Off-Flow Or Flirty Messages

If user says things like "sos linda", "salimos?", "queres una cena", answer warmly but return to the booking flow.

Do not flirt back. Do not break character. Do not reset unless user asks reset.

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

## Where To Look

Main files:
- `src/services/booking-conversation-flow.ts`
- `src/services/conversation-service.ts`
- `src/services/message-understanding-service.ts`
- `src/services/ai-message-understanding-service.ts`
- `src/services/bot-copy-service.ts`

If behavior changes, update this skill with the new regression rule before ending the task.
