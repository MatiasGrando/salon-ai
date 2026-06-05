import Fastify from 'fastify'
import { healthRoutes } from './routes/health.js'
import { businessRoutes } from './routes/business.js'
import { professionalRoutes } from './routes/professional.js'
import { serviceRoutes } from './routes/service.js'
import { customerRoutes } from './routes/customer.js'
import { appointmentRoutes } from './routes/appointment.js'
import { businessHoursRoutes } from './routes/business-hours.js'
import { professionalHoursRoutes } from './routes/professional-hours.js'
import { availabilityRoutes } from './routes/availability.js'
import { chatRoutes } from './routes/chat.js'
import { whatsappWebhookRoutes } from './routes/whatsapp-webhook.js'

process.env.TZ ??= 'America/Argentina/Buenos_Aires'

const app = Fastify()
const port = Number(process.env.PORT ?? 3000)
const host = process.env.HOST ?? '0.0.0.0'

await app.register(healthRoutes)
await app.register(businessRoutes)
await app.register(professionalRoutes)
await app.register(serviceRoutes)
await app.register(customerRoutes)
await app.register(appointmentRoutes)
await app.register(businessHoursRoutes)
await app.register(professionalHoursRoutes)
await app.register(availabilityRoutes)
await app.register(chatRoutes)
await app.register(whatsappWebhookRoutes)

if (process.env.NODE_ENV !== 'production') {
  console.log(app.printRoutes())
}

app.listen({ port, host }, (err, address) => {
  if (err) {
    console.error(err)
    process.exit(1)
  }

  console.log(`Servidor iniciado en ${address}`)
})
