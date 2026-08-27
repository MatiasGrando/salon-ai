# Runbook de locks de agenda

## Invariante universal

Todo writer que pueda cambiar disponibilidad debe ejecutar dentro de **una única transacción PostgreSQL** y adquirir, sin excepciones, este orden:

1. lock transaccional de agenda del negocio;
2. locks transaccionales de agenda profesional, deduplicados y ordenados ascendentemente por ID;
3. filas objetivo con `FOR UPDATE`, también en orden estable;
4. revalidaciones finales de pertenencia, actividad, asociación de servicios, horarios, bloqueos y solapamientos;
5. escritura y commit.

No se hacen llamadas de red mientras se retienen locks. No se usan locks de sesión.

## Namespace y claves exactas

- Namespace versionado: `salon-ai:agenda:v1`.
- Negocio: `salon-ai:agenda:v1:business:<businessId>`.
- Profesional: `salon-ai:agenda:v1:professional:<professionalId>`.
- SQL: `pg_advisory_xact_lock(hashtextextended(<clave>, 0))`.

`hashtextextended` produce una clave advisory de 64 bits y separa tipos mediante el prefijo versionado. La probabilidad de colisión no es cero; es materialmente menor que con `hashtext` de 32 bits. Cambiar namespace, semilla u orden requiere una migración coordinada de **todos** los writers: mezclar versiones elimina la exclusión mutua.

## API canónica

`src/services/agenda-locks.ts` expone:

- `acquireBusinessAgendaLock`;
- `acquireProfessionalAgendaLocks` (valida pertenencia al negocio y ordena/deduplica);
- `acquireAgendaHierarchy` (API normal; omitir IDs bloquea todos los profesionales actuales del negocio);
- `lockAppointmentRows` y `lockScheduleBlockRows` para filas objetivo tenant-scoped.

Una operación multiprofesional bloquea **todos** los profesionales involucrados en orden ascendente, incluso el profesional anterior de un turno movido. Un bloqueo global o una mutación de configuración reservable bloquea el negocio y todos sus profesionales actuales. La creación concurrente de profesionales también toma primero el lock del negocio, por lo que no puede escapar del snapshot protegido.

## Failure modes

- Profesional ajeno o fila objetivo ajena/inexistente: abortar la transacción (`AgendaLockScopeError`), nunca continuar parcialmente.
- Writer sin jerarquía compatible: mantener confirmaciones automáticas deshabilitadas; un advisory lock aislado no protege nada frente a ese writer.
- Timeout/deadlock: abortar y reintentar la operación completa con idempotencia en la capa de caso de uso; nunca reintentar sólo la escritura final.
- Crash: PostgreSQL libera automáticamente todos los `pg_advisory_xact_lock` al abortar/cerrar la transacción.
