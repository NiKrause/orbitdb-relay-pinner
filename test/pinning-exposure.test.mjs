import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
	areRecordValuesExposed,
	redactLastRecord,
} from '../dist/config/pinning-exposure-env.js'

const FLAG = 'RELAY_PINNING_EXPOSE_RECORD_VALUES'
const RECORD = { hash: 'zdpuAexample', key: '457fb50f', value: 'buy milk' }

/** Run `fn` with the flag set, then restore the environment. */
function withFlag(value, fn) {
	const previous = process.env[FLAG]
	if (value === undefined) delete process.env[FLAG]
	else process.env[FLAG] = value
	try {
		return fn()
	} finally {
		if (previous === undefined) delete process.env[FLAG]
		else process.env[FLAG] = previous
	}
}

test('record contents are withheld by default', () => {
	const out = withFlag(undefined, () => redactLastRecord(RECORD))
	assert.equal(out.hash, 'zdpuAexample')
	assert.equal(out.redacted, true)
	assert.equal(out.value, undefined, 'the plaintext must not leave the relay')
	assert.equal(out.key, undefined, 'an application-chosen key may itself be meaningful')
})

test('a field added later is withheld too', () => {
	// Rebuilt rather than deleted from, so a new field is not published by
	// default — the wrong way round for an unauthenticated endpoint.
	const out = withFlag(undefined, () => redactLastRecord({ ...RECORD, author: 'did:key:z6Mk' }))
	assert.equal(out.author, undefined)
})

test('the flag brings the whole record back for debugging', () => {
	for (const value of ['1', 'true', 'TRUE']) {
		const out = withFlag(value, () => redactLastRecord(RECORD))
		assert.deepEqual(out, RECORD, `flag value ${value} should expose`)
	}
})

test('anything other than 1 or true stays closed', () => {
	for (const value of ['0', 'false', 'yes', '']) {
		assert.equal(withFlag(value, areRecordValuesExposed), false, `flag value ${value}`)
	}
})

test('a missing record stays null in both modes', () => {
	assert.equal(withFlag(undefined, () => redactLastRecord(null)), null)
	assert.equal(withFlag('1', () => redactLastRecord(undefined)), null)
})
