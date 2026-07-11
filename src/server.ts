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
import { crmRoutes } from './routes/crm.js'
import { crmUiRoutes } from './routes/crm-ui.js'
import { landingUiRoutes } from './routes/landing-ui.js'
import { publicBookingRoutes } from './routes/public-booking.js'
import { scheduleBlockRoutes } from './routes/schedule-block.js'
import { whatsappWebhookRoutes } from './routes/whatsapp-webhook.js'
import { campaignRoutes } from './routes/campaign.js'
import { reportRoutes } from './routes/report.js'
import { authRoutes } from './routes/auth.js'
import { staffUserRoutes } from './routes/staff-user.js'
import { authGuard } from './plugins/auth-guard.js'
import { ensureBootstrapSuperAdmin } from './services/auth-service.js'
import { startMarketingScheduler } from './services/marketing-scheduler.js'

process.env.TZ ??= 'America/Argentina/Buenos_Aires'

const app = Fastify({
  bodyLimit: 5 * 1024 * 1024
})
const port = Number(process.env.PORT ?? 3000)
const host = process.env.HOST ?? '0.0.0.0'

await app.register(healthRoutes)
await app.register(authRoutes)
await app.register(crmUiRoutes)
await app.register(landingUiRoutes)
await app.register(publicBookingRoutes)
await app.register(whatsappWebhookRoutes)
await authGuard(app)
await app.register(businessRoutes)
await app.register(professionalRoutes)
await app.register(serviceRoutes)
await app.register(customerRoutes)
await app.register(appointmentRoutes)
await app.register(businessHoursRoutes)
await app.register(professionalHoursRoutes)
await app.register(scheduleBlockRoutes)
await app.register(availabilityRoutes)
await app.register(chatRoutes)
await app.register(crmRoutes)
await app.register(campaignRoutes)
await app.register(reportRoutes)
await app.register(staffUserRoutes)
await ensureBootstrapSuperAdmin()
startMarketingScheduler(app)

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
