# Membresias prepagas por servicio

Implementacion en CRM y reservas web autenticadas. La compra paga los servicios incluidos; cada atencion consume un cupo y genera la comision del profesional sobre el valor interno del servicio.

## Condiciones

- Cada servicio tiene cantidad de usos y un precio fijo o descuento porcentual. La suma de cantidades por precio unitario debe coincidir con el precio de compra.
- Plata: $50.000 por dos cortes de $25.000. Oro: $80.000 por cuatro cortes de $20.000. Son ejemplos de configuracion; no se crean planes en comercios reales automaticamente.
- Vigencia configurable en dias calendario, con inicio y ultimo dia incluidos. Se valida la fecha local de atencion del comercio.
- La compra conserva sus precios, servicios, cantidades y politicas aunque despues cambie el catalogo.
- Al reservar se aparta el cupo; al completar se consume. Cancelaciones y ausencias siguen la politica elegida al crear el plan.
- Si falta cobertura o se agota un servicio, se puede reservar a precio normal. Los servicios adicionales no quedan cubiertos por el saldo de otro servicio.
- El ingreso se registra una vez en Caja, al comprar. Atender y comisionar no generan otro ingreso. Se bloquea revertir una compra con usos reservados o consumidos.
- Las reservas coordinadas acumulan cobertura en su cuenta compartida y conservan el valor individual para comisionar. La sena corresponde a los servicios que siguen pendientes de pago.
- Un telefono escrito por un invitado no habilita beneficios de otra persona. La aplicacion automatica web requiere una cuenta autenticada con telefono verificado. El perfil web permite editar el telefono, pero todavia no ofrece un flujo de verificacion.

## Interfaz

Servicios > Membresías abre el catálogo para crear planes con los servicios del local. Clientes > Membresías también abre ese catálogo. En la ficha de cada cliente, Membresías permite registrar la compra, revisar vigencia y saldos por servicio, o aplicar cobertura a un turno existente sin cobros previos.

El formulario tiene contenedor propio, tabla de servicios, total comprobable, errores integrados y acciones en el pie fijo. Escala su contenido al aumentar ancho o alto y conserva el tamano al reabrir. En movil respeta el viewport y permite desplazar la tabla.

## Verificacion

- `npm run test:memberships`: precios, cupos independientes, periodos, compra idempotente, cuenta compartida y ejecucion de migraciones/comisiones en PostgreSQL offline con PGlite.
- `npm run test:memberships-ui`: Chrome real; creacion, compra y confirmacion integrada, saldos, escala horizontal/vertical/combinada, reapertura y movil.
- Regresiones de codificacion, sintaxis del CRM, reservas web y pagos manuales.
- PGlite utiliza una conexion; no certifica contencion entre procesos PostgreSQL reales.

## Publicacion

Requiere desplegar ambas migraciones `202611240001_booking_programs` y `202611250001_membership_service_quotas`, regenerar Prisma y publicar el servidor. No se aplicaron cambios sobre una base de produccion.

La integracion propia del bot por opciones, los cobros recurrentes automaticos y la venta publica de membresias quedan fuera de esta implementacion. Los planes existentes con cupos compartidos mantienen su compatibilidad.
