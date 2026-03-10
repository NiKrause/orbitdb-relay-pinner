export const loggingConfig = {
  enableGeneralLogs: process.env.ENABLE_GENERAL_LOGS === 'true' || process.env.ENABLE_GENERAL_LOGS === '1',
  enableSyncLogs: process.env.ENABLE_SYNC_LOGS === 'true' || process.env.ENABLE_SYNC_LOGS === '1',
  enableSyncStats: process.env.ENABLE_SYNC_STATS === 'true' || process.env.ENABLE_SYNC_STATS === '1',
  enableHeadsStreamLogs: process.env.ENABLE_HEADS_STREAM_LOGS !== 'false' && process.env.ENABLE_HEADS_STREAM_LOGS !== '0',
  logLevels: {
    connection: process.env.LOG_LEVEL_CONNECTION === 'true',
    peer: process.env.LOG_LEVEL_PEER === 'true',
    database: process.env.LOG_LEVEL_DATABASE === 'true',
    sync: process.env.LOG_LEVEL_SYNC === 'true',
  },
}
