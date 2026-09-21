import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const route = readFileSync(new URL('../src/routes/campaign.ts', import.meta.url), 'utf8')
const scheduler = readFileSync(new URL('../src/services/marketing-scheduler.ts', import.meta.url), 'utf8')
const ui = readFileSync(new URL('../src/routes/crm-ui.ts', import.meta.url), 'utf8')

assert.match(route, /normalized\.type === 'AUTOMATED'[\s\S]{0,200}reply\.status\(409\)/)
assert.match(route, /app\.post\('\/campaigns\/:id\/process-automated'[\s\S]{0,260}AUTOMATED_CAMPAIGNS_TEMPORARILY_DISABLED[\s\S]{0,120}reply\.status\(409\)/)
assert.match(scheduler, /if \(AUTOMATED_CAMPAIGNS_TEMPORARILY_DISABLED\) return/)
assert.match(scheduler, /if \(!AUTOMATED_CAMPAIGNS_TEMPORARILY_DISABLED\) \{[\s\S]*scheduledAutomatedCampaigns/)
assert.match(route, /campaign-jobs\/process-retries'[\s\S]{0,220}AUTOMATED_CAMPAIGNS_TEMPORARILY_DISABLED/)
assert.match(route, /type: AUTOMATED_CAMPAIGNS_TEMPORARILY_DISABLED \? 'ONE_TIME' : current\.type/)
assert.match(ui, /<option value="AUTOMATED" disabled>/)
assert.doesNotMatch(ui, /renderCampaigns\(\)\s*loadCampaignAudience\(state\.selectedCampaignId\)/)
assert.match(route, /runs:\s*\{\s*where:\s*\{ mode: \{ in: \['ESTIMATE', 'SIMULATION'\] \} \}/)

assert.match(route, /app\.post\('\/campaigns\/:id\/estimate'[\s\S]*mode: 'ESTIMATE'/)
assert.match(ui, /getJson\('\/campaigns\/' \+ saved\.id \+ '\/estimate'/)
assert.match(ui, /campaign\.type === 'AUTOMATED' \? 'PAUSED' : campaign\.status/)

console.log('Campaign punctual-only contract: OK')
