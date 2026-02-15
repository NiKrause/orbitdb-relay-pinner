#!/usr/bin/env node
import 'dotenv/config'
import { startRelay } from './relay.js'

function hasFlag(name: string) {
  return process.argv.includes(name)
}

async function main() {
  const runtime = await startRelay({
    testMode: hasFlag('--test'),
  })

  const handleShutdown = async () => {
    try {
      await runtime.stop()
    } finally {
      process.exit(0)
    }
  }

  process.on('SIGINT', handleShutdown)
  process.on('SIGTERM', handleShutdown)
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err)
  process.exit(1)
})
