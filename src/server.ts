import Fastify from 'fastify'
import { healthRoutes } from './routes/health.js'
import { businessRoutes } from './routes/business.js'

const app = Fastify()

await app.register(healthRoutes)
await app.register(businessRoutes)

app.listen({ port: 3000 }, (err, address) => {
  if (err) {
    console.error(err)
    process.exit(1)
  }

  console.log(`Servidor iniciado en ${address}`)
})
