/**
 * What `/pinning/*` is allowed to say about the contents it holds.
 *
 * `lastRecord` carries `hash`, `key` and `value` — the plaintext of the newest
 * entry. On an unauthenticated endpoint that publishes the contents of
 * databases the relay is holding for other people, which contradicts the
 * point of offering to hold them (#54). `hash` is a content address and
 * reveals nothing on its own; `key` is application-chosen and may itself be
 * meaningful.
 *
 * The field is genuinely useful when working out why a sync produced nothing,
 * so it stays available behind a flag rather than being deleted.
 *
 * Development only. Setting this on a relay that holds other people's data
 * publishes that data.
 */
export function areRecordValuesExposed(): boolean {
  const v = process.env.RELAY_PINNING_EXPOSE_RECORD_VALUES?.trim().toLowerCase()
  return v === '1' || v === 'true'
}

/**
 * Strip a pinned record down to what an outside caller may see.
 *
 * @param record the stored `lastRecord`, or null
 * @returns the record with `key` and `value` removed, unless the flag is set
 */
export function redactLastRecord(
  record: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (record == null) return null
  if (areRecordValuesExposed()) return record

  const { hash } = record
  // Rebuilt rather than deleted from: a future field would otherwise be
  // published by default, which is the wrong way round for this endpoint.
  return { hash: hash ?? null, redacted: true }
}
