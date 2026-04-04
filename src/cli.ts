#!/usr/bin/env node
import 'dotenv/config'
import { startRelay } from './relay.js'
import type { RelayRuntime } from './relay.js'

function hasFlag(name: string) {
  return process.argv.includes(name)
}

const STOP_TIMEOUT_MS = Number(process.env.RELAY_STOP_TIMEOUT_MS || '20000')

let runtime: RelayRuntime | undefined
let stopRequested = false

function requestStop() {
  if (stopRequested) {
    process.stderr.write('\nInterrupt again to exit immediately.\n')
    process.exit(1)
  }
  stopRequested = true
  process.stderr.write('\nShutting down…\n')

  void (async () => {
    try {
      if (runtime) {
        await Promise.race([
          runtime.stop(),
          new Promise<void>((resolve) => {
            setTimeout(resolve, STOP_TIMEOUT_MS)
          }),
        ])
      }
    } catch {
      // ignore
    } finally {
      process.exit(0)
    }
  })()
}

async function main() {
  process.on('SIGINT', requestStop)
  process.on('SIGTERM', requestStop)

  runtime = await startRelay({
    testMode: hasFlag('--test'),
  })
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err)
  process.exit(1)
})
