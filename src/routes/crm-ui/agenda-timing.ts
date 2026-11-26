export const agendaTimingScript = String.raw`
    const agendaTiming = new URLSearchParams(window.location.search).get('agendaTiming') === '1'
      ? createAgendaTimingRecorder()
      : null

    function createAgendaTimingRecorder() {
      const samples = []
      let generation = 0
      window.weexAgendaTiming = {
        read: () => structuredClone(samples),
        reset: () => { samples.length = 0; generation += 1 }
      }

      return {
        start(action) {
          const startedAt = performance.now()
          const currentGeneration = generation
          const sample = { action, scenario: null, outcome: null, totalMs: null, marksMs: {}, requests: [] }
          const elapsed = () => Math.round(performance.now() - startedAt)
          const publish = () => {
            if (currentGeneration !== generation) return
            samples.push(sample)
            if (samples.length > 100) samples.shift()
            console.info('[Agenda timing]', structuredClone(sample))
          }

          return {
            scenario: (name) => { sample.scenario = name },
            mark: (phase) => { sample.marksMs[phase] = elapsed() },
            request: (phase) => {
              const startMs = elapsed()
              return (response) => {
                sample.requests.push({
                  phase, startMs, durationMs: elapsed() - startMs,
                  status: response?.status ?? null,
                  serverTiming: response?.headers.get('Server-Timing') ?? null
                })
              }
            },
            finish(outcome, isRendered) {
              sample.outcome = outcome
              sample.totalMs = elapsed()
              if (isRendered?.() && document.visibilityState === 'visible') {
                requestAnimationFrame(() => requestAnimationFrame(() => {
                  if (isRendered()) sample.marksMs.visible = elapsed()
                  publish()
                }))
              } else {
                publish()
              }
            }
          }
        }
      }
    }
`
