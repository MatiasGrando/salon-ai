import type { FastifyInstance } from 'fastify'
import { prisma } from '../config/prisma.js'

const DEFAULT_CAMPAIGN_INTERVAL_HOURS = 12
const DEFAULT_REMINDER_INTERVAL_MINUTES = 15

type SchedulerState = {
  campaignsRunning: boolean
  remindersRunning: boolean
  stopped: boolean
  campaignTimer?: NodeJS.Timeout
  reminderTimer?: NodeJS.Timeout
}

export function startMarketingScheduler(app: FastifyInstance) {
  const configured = process.env.AUTOMATION_SCHEDULER_ENABLED?.trim().toLowerCase()
  const enabled = configured === 'true' || (configured !== 'false' && process.env.NODE_ENV === 'production')
  if (!enabled) {
    app.log.info('Procesador automatico desactivado. Usa AUTOMATION_SCHEDULER_ENABLED=true para activarlo.')
    return
  }

  const campaignIntervalMs = positiveNumber(process.env.AUTOMATED_CAMPAIGN_INTERVAL_HOURS, DEFAULT_CAMPAIGN_INTERVAL_HOURS) * 60 * 60 * 1000
  const reminderIntervalMs = positiveNumber(process.env.REMINDER_PROCESS_INTERVAL_MINUTES, DEFAULT_REMINDER_INTERVAL_MINUTES) * 60 * 1000
  const state: SchedulerState = { campaignsRunning: false, remindersRunning: false, stopped: false }

  const processCampaigns = async () => {
    if (state.stopped || state.campaignsRunning) return
    state.campaignsRunning = true
    try {
      const now = new Date()
      const campaigns = await prisma.campaign.findMany({
        where: {
          type: 'AUTOMATED',
          status: 'ACTIVE',
          whatsappTemplate: { status: 'APPROVED' },
          OR: [
            { scheduleMode: 'IMMEDIATE' },
            { scheduledAt: null },
            { scheduledAt: { lte: now } }
          ]
        },
        select: {
          id: true,
          runs: {
            where: { mode: 'REAL' },
            select: { createdAt: true },
            orderBy: { createdAt: 'desc' },
            take: 1
          }
        }
      })

      for (const campaign of campaigns) {
        const lastRunAt = campaign.runs[0]?.createdAt
        if (lastRunAt && now.getTime() - lastRunAt.getTime() < campaignIntervalMs) continue
        const response = await app.inject({ method: 'POST', url: '/campaigns/' + campaign.id + '/process-automated', payload: { limit: 100 } })
        if (response.statusCode >= 400 && response.statusCode !== 409) {
          app.log.error({ campaignId: campaign.id, statusCode: response.statusCode, body: response.body }, 'Fallo el procesamiento de una campana automatica')
        }
      }
    } catch (error) {
      app.log.error(error, 'Fallo el ciclo de campanas automaticas')
    } finally {
      state.campaignsRunning = false
    }
  }

  const processReminders = async () => {
    if (state.stopped || state.remindersRunning) return
    state.remindersRunning = true
    try {
      const now = new Date()
      const oneTimeCampaigns = await prisma.campaign.findMany({
        where: {
          type: 'ONE_TIME',
          status: 'SCHEDULED',
          scheduleMode: 'SCHEDULED',
          scheduledAt: { lte: now },
          whatsappTemplate: { status: 'APPROVED' }
        },
        select: { id: true }
      })
      for (const campaign of oneTimeCampaigns) {
        const response = await app.inject({ method: 'POST', url: '/campaigns/' + campaign.id + '/execute-one-time' })
        if (response.statusCode >= 400 && response.statusCode !== 409) {
          app.log.error({ campaignId: campaign.id, statusCode: response.statusCode, body: response.body }, 'Fallo una campana puntual programada')
        }
      }

      const scheduledAutomatedCampaigns = await prisma.campaign.findMany({
        where: {
          type: 'AUTOMATED',
          status: 'ACTIVE',
          scheduleMode: 'SCHEDULED',
          scheduledAt: { lte: now },
          whatsappTemplate: { status: 'APPROVED' },
          runs: { none: { mode: 'REAL' } }
        },
        select: { id: true }
      })
      for (const campaign of scheduledAutomatedCampaigns) {
        const response = await app.inject({ method: 'POST', url: '/campaigns/' + campaign.id + '/process-automated', payload: { limit: 100 } })
        if (response.statusCode >= 400 && response.statusCode !== 409) {
          app.log.error({ campaignId: campaign.id, statusCode: response.statusCode, body: response.body }, 'Fallo el inicio de una campana automatica programada')
        }
      }

      const retryResponse = await app.inject({ method: 'POST', url: '/campaign-jobs/process-retries', payload: { limit: 100 } })
      if (retryResponse.statusCode >= 400) {
        app.log.error({ statusCode: retryResponse.statusCode, body: retryResponse.body }, 'Fallo el procesamiento de reintentos tecnicos')
      }

      const businesses = await prisma.reminderAutomation.findMany({
        where: { enabled: true, channel: 'WHATSAPP' },
        distinct: ['businessId'],
        select: { businessId: true }
      })
      for (const business of businesses) {
        const response = await app.inject({
          method: 'POST',
          url: '/reminder-automations/process-due',
          payload: { businessId: business.businessId, limit: 100 }
        })
        if (response.statusCode >= 400) {
          app.log.error({ businessId: business.businessId, statusCode: response.statusCode, body: response.body }, 'Fallo el procesamiento de recordatorios')
        }
      }
    } catch (error) {
      app.log.error(error, 'Fallo el ciclo de recordatorios automaticos')
    } finally {
      state.remindersRunning = false
    }
  }

  state.campaignTimer = setInterval(processCampaigns, campaignIntervalMs)
  state.reminderTimer = setInterval(processReminders, reminderIntervalMs)
  state.campaignTimer.unref()
  state.reminderTimer.unref()

  const initialTimer = setTimeout(() => {
    void processCampaigns()
    void processReminders()
  }, 30_000)
  initialTimer.unref()

  app.addHook('onClose', async () => {
    state.stopped = true
    clearTimeout(initialTimer)
    if (state.campaignTimer) clearInterval(state.campaignTimer)
    if (state.reminderTimer) clearInterval(state.reminderTimer)
  })

  app.log.info({
    campaignIntervalHours: campaignIntervalMs / 3_600_000,
    reminderIntervalMinutes: reminderIntervalMs / 60_000
  }, 'Procesador automatico de Marketing iniciado')
}

function positiveNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}
