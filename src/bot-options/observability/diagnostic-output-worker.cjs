// Native Node worker: no tsx hook, dynamic code, private values or external dependencies.
const { parentPort } = require('node:worker_threads')
const { writeSync } = require('node:fs')

parentPort.on('message', ({ id, lines }) => {
  let ok = false
  try {
    if (!Array.isArray(lines) || lines.length > 64) throw new Error('Invalid batch')
    for (const line of lines) {
      if (typeof line !== 'string' || Buffer.byteLength(line, 'utf8') > 65536) throw new Error('Invalid record')
      const bytes = Buffer.from(line + '\n', 'utf8')
      let offset = 0
      while (offset < bytes.length) {
        const written = writeSync(1, bytes, offset, bytes.length - offset)
        if (written <= 0) throw new Error('Output unavailable')
        offset += written
      }
    }
    ok = true
  } catch { /* Report only success/failure, never message content or filesystem error details. */ }
  parentPort.postMessage({ id, ok })
})
