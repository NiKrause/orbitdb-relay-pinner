export const loggingConfig = {
  enableGeneralLogs: process.env.ENABLE_GENERAL_LOGS !== 'false' && process.env.ENABLE_GENERAL_LOGS !== '0',
  enableSyncLogs: process.env.ENABLE_SYNC_LOGS !== 'false' && process.env.ENABLE_SYNC_LOGS !== '0',
  enableSyncStats: process.env.ENABLE_SYNC_STATS !== 'false' && process.env.ENABLE_SYNC_STATS !== '0',
  logLevels: {
    connection: process.env.LOG_LEVEL_CONNECTION === 'true',
    peer: process.env.LOG_LEVEL_PEER === 'true',
    database: process.env.LOG_LEVEL_DATABASE === 'true',
    sync: process.env.LOG_LEVEL_SYNC === 'true',
  },
}

