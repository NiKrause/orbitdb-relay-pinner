import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'

import { DatabaseService } from '../dist/services/database.js'

describe('database service update-event pinning', function () {
  this.timeout(10000)

  it('pins media CID from update entry without full db.all() scan', async () => {
    const service = new DatabaseService()

    const imageCid = 'bafkreiad2y7aldkdy6vfxazrdb5s2tcebev6levelxomvavd2acyll67pe'
    const pinned = []
    let allCalls = 0

    const events = new EventEmitter()
    const db = {
      events,
      all: async () => {
        allCalls += 1
        return []
      },
      close: async () => {},
    }

    service.ipfs = {
      pins: {
        add: async function * (cid) {
          pinned.push(cid.toString())
          yield cid
        },
      },
    }

    service.orbitdb = {
      open: async () => db,
      stop: async () => {},
    }

    const syncPromise = service.syncAllOrbitDBRecords('/orbitdb/zdpuTestAddressForUpdatePinning')

    setTimeout(() => {
      events.emit('update', {
        payload: {
          value: {
            imageCid,
            text: 'post created via update event',
          },
        },
      })
    }, 50)

    await syncPromise
    await service.pinQueue.onIdle()

    assert.equal(allCalls, 0, 'db.all() should not be called for update-driven pinning')
    assert.deepEqual(pinned, [imageCid])

    await service.stop()
  })
})
