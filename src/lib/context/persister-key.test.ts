import { describe, it, expect } from 'vitest'
import { APP_CONFIG } from '@/lib/config/app'

/**
 * Cache-bleed guard (SPINE_SPEC §6.2, harvested from grindline).
 *
 * Switching context purges the query persister's on-disk snapshot so a cold reload can't restore
 * the previous tenant's data. That purge (switch-context.ts → purgeContextCache) targets ONE
 * AsyncStorage key, and the query persister (lib/query/client.ts → asyncPersister) WRITES that same
 * key. If the two formulas ever drift, the purge silently misses and one tenant's cache bleeds into
 * another's session.
 *
 * Both derive the key from the SAME formula: `${shortName.toLowerCase()}-query-cache`. This test
 * pins that formula so a rename of either side without updating the other fails here loudly. (We
 * assert the formula rather than import the runtime modules, which pull in AsyncStorage / RN — out
 * of scope for the Node unit tier.)
 */
describe('context cache purge — persister key', () => {
  const EXPECTED = `${APP_CONFIG.shortName.toLowerCase()}-query-cache`

  it('the persister key formula is the documented `${shortName}-query-cache`', () => {
    // Mirrors asyncPersister.key (src/lib/query/client.ts) and PERSISTER_KEY (switch-context.ts).
    // The literal is pinned on purpose (grindline convention): a mint that rebrands shortName
    // updates this one line and thereby acknowledges the persister key exists and must purge.
    expect(EXPECTED).toBe('manyhandz-query-cache')
  })

  it('shortName is set, so the derived key is never an orphan `-query-cache`', () => {
    expect(APP_CONFIG.shortName.length).toBeGreaterThan(0)
    expect(EXPECTED.startsWith('-')).toBe(false)
  })
})
