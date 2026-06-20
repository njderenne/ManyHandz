import { createAudioPlayer } from 'expo-audio'
import { usePrefs } from '@/lib/prefs'

/**
 * Standard UI sounds. Cached players; call `playSound('success')`. Swap the .wav files in
 * assets/sounds/ (or regenerate via scripts/generate-sounds.mjs) to rebrand the set per app.
 * Respects the user's Settings toggle. Swallows errors — a sound should never crash a flow.
 */
const SOURCES = {
  tap: require('../../../assets/sounds/tap.wav'),
  success: require('../../../assets/sounds/success.wav'),
  error: require('../../../assets/sounds/error.wav'),
  notify: require('../../../assets/sounds/notify.wav'),
}
export type SoundName = keyof typeof SOURCES

type Player = ReturnType<typeof createAudioPlayer>
const players: Partial<Record<SoundName, Player>> = {}

export function playSound(name: SoundName) {
  if (!usePrefs.getState().soundsEnabled) return
  try {
    const player = (players[name] ??= createAudioPlayer(SOURCES[name]))
    player.seekTo(0)
    player.play()
  } catch {
    // ignore
  }
}

export const SOUND_NAMES = Object.keys(SOURCES) as SoundName[]

// Pre-warm the players so the first tap isn't delayed by native init.
for (const name of SOUND_NAMES) {
  try {
    players[name] = createAudioPlayer(SOURCES[name])
  } catch {
    // ignore
  }
}
