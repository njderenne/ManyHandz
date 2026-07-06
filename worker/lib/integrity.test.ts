import { describe, it, expect } from 'vitest'
import { canonicalJson, sha256Hex } from './integrity'

describe('canonicalJson — Date handling', () => {
  it('serializes a Date to its ISO string, not {}', () => {
    const json = canonicalJson({ a: new Date('2026-01-02T03:04:05.000Z') })
    expect(json).toContain('2026-01-02T03:04:05.000Z')
    expect(json).not.toContain('{}')
    expect(json).toBe('{"a":"2026-01-02T03:04:05.000Z"}')
  })

  it('hashes timestamp content — records differing only in WHEN hash differently', async () => {
    const a = await sha256Hex(canonicalJson({ at: new Date('2026-01-02T03:04:05.000Z') }))
    const b = await sha256Hex(canonicalJson({ at: new Date('2026-01-02T03:04:06.000Z') }))
    expect(a).not.toBe(b)
  })

  it('is reproducible — the stamp matches a re-hash of the serialized HTTP payload', async () => {
    const payload = { at: new Date('2026-01-02T03:04:05.000Z') }
    const stamped = await sha256Hex(canonicalJson(payload))
    // What a verifier sees on the wire (Date.toJSON → ISO) and re-hashes.
    const onWire = JSON.parse(JSON.stringify(payload))
    const reHashed = await sha256Hex(canonicalJson(onWire))
    expect(reHashed).toBe(stamped)
  })
})
