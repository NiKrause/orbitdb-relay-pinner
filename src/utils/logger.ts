import { logger, enable } from '@libp2p/logger'
import { loggingConfig } from '../config/logging.js'

const baseLogger = logger('le-space:relay')

if (loggingConfig.enableGeneralLogs) enable('le-space:relay:*')

const syncLogger = logger('le-space:relay:sync')
if (loggingConfig.enableSyncLogs) enable('le-space:relay:sync')

export const log: (...args: any[]) => void = loggingConfig.enableGeneralLogs ? (baseLogger as any) : () => {}
export const syncLog: (...args: any[]) => void = loggingConfig.enableSyncLogs ? (syncLogger as any) : () => {}

export const logSyncStats = (
  dbType: string,
  address: string,
  peerId: string | undefined,
  recordCounts: { posts?: number; comments?: number; media?: number },
  previousCounts: { posts?: number; comments?: number; media?: number } = {},
) => {
  if (!loggingConfig.enableSyncStats) return

  const changes = {
    posts: (recordCounts.posts || 0) - (previousCounts.posts || 0),
    comments: (recordCounts.comments || 0) - (previousCounts.comments || 0),
    media: (recordCounts.media || 0) - (previousCounts.media || 0),
  }
  const hasChanges = Object.values(changes).some((c) => c !== 0)
  if (!hasChanges && !loggingConfig.enableSyncLogs) return

  const timestamp = new Date().toISOString()
  // eslint-disable-next-line no-console
  console.log(`[${timestamp}] 🔄 DB_SYNC: ${dbType}`)
  // eslint-disable-next-line no-console
  console.log(`  📍 Address: ${address}`)
  // eslint-disable-next-line no-console
  console.log(`  👤 Peer: ${peerId || 'local'}`)
  // eslint-disable-next-line no-console
  console.log(
    `  📊 Records: Posts=${recordCounts.posts || 0}, Comments=${recordCounts.comments || 0}, Media=${recordCounts.media || 0}`,
  )
  if (hasChanges) {
    // eslint-disable-next-line no-console
    console.log(
      `  📈 Changes: Posts=${changes.posts >= 0 ? '+' : ''}${changes.posts}, Comments=${changes.comments >= 0 ? '+' : ''}${changes.comments}, Media=${changes.media >= 0 ? '+' : ''}${changes.media}`,
    )
  }
  // eslint-disable-next-line no-console
  console.log('  ─────────────────────────────────────────────────────────')
}

