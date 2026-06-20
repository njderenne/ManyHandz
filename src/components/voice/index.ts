/**
 * Voice — two drop-in components over lib/native/audio.ts (expo-audio), both gated on
 * APP_CONFIG.features.voice:
 *   <VoiceNote>          record → speech-to-text; the TRANSCRIPT is the artifact (dictation, AI input)
 *   <VoiceMemo>          record → save the AUDIO; the RECORDING is the artifact (keepsakes, voice notes)
 *   <VoiceMemoPlayer>    play back a saved memo by its media id
 */
export { VoiceNote, type VoiceNoteProps } from './voice-note'
export { VoiceMemo, type VoiceMemoProps } from './voice-memo'
export { VoiceMemoPlayer, type VoiceMemoPlayerProps } from './voice-memo-player'
