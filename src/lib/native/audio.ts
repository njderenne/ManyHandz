import { useState } from 'react'
import {
  AudioModule,
  createAudioPlayer,
  useAudioRecorder,
  RecordingPresets,
  setAudioModeAsync,
} from 'expo-audio'
import { File, Paths } from 'expo-file-system'
import { uploadAsync, FileSystemUploadType } from 'expo-file-system/legacy'
import { API_BASE_URL, authHeaders } from '@/lib/api/client'

/**
 * Voice (client) — ElevenLabs through the Worker.
 *   speak(text)            → fetch TTS audio, cache it, play it (expo-audio)
 *   useVoiceTranscriber()  → record audio, upload to STT, get the transcript
 *
 * Requires a signed-in session and a native build (expo-audio is a native module). Device
 * validation pending — these wire the flow; confirm playback/recording on a real device.
 */
/** Tiny stable hash (djb2) — cache key for spoken phrases. */
function hash(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  return h.toString(36)
}

export async function speak(text: string, opts: { voiceId?: string } = {}): Promise<void> {
  // Replays of the same phrase play instantly from the cached file — no network round-trip.
  const file = new File(Paths.cache, `tts-${hash(`${opts.voiceId ?? ''}|${text}`)}.mp3`)
  if (!file.exists) {
    const res = await fetch(`${API_BASE_URL}/api/voice/tts`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ text, voiceId: opts.voiceId }),
    })
    if (!res.ok) throw new Error(`TTS failed (${res.status})`)
    file.write(new Uint8Array(await res.arrayBuffer()))
  }
  createAudioPlayer(file.uri).play()
}

/**
 * Stateful mic recording → the local audio file (kept, NOT transcribed). For voice MEMOS — the
 * recording is the artifact (save it to media for playback later). `stop()` returns the file uri;
 * upload it with uploadMedia(uri, { mimeType: 'audio/mp4' }). Pairs with playMemo() for review.
 */
export function useVoiceMemo() {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY)
  const [isRecording, setIsRecording] = useState(false)

  async function start(): Promise<boolean> {
    const { granted } = await AudioModule.requestRecordingPermissionsAsync()
    if (!granted) return false
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true })
    await recorder.prepareToRecordAsync()
    recorder.record()
    setIsRecording(true)
    return true
  }

  /** Stop recording and return the local audio file uri (null if nothing was captured). */
  async function stop(): Promise<string | null> {
    await recorder.stop()
    // Hand the iOS audio session back to playback. Without this the session stays in
    // record-capable mode (.playAndRecord) after the first recording, so the NEXT start() contends
    // for a session it never released — the "have to tap record dozens of times" bug.
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true })
    setIsRecording(false)
    return recorder.uri ?? null
  }

  return { isRecording, start, stop }
}

/** Play a LOCAL audio clip (a just-recorded uri or a cached memo file). Returns the player. */
export function playMemo(uri: string) {
  return createAudioPlayer(uri) // returns the player: .play()/.pause()/.seekTo() as needed
}

/**
 * Fetch a SAVED memo (GET /api/media/:id is auth-gated, so a raw URL won't stream) into a cached
 * local file and return its uri to hand to playMemo(). Same fetch→write→play pattern as speak();
 * re-plays hit the cache. Requires a signed-in session.
 */
export async function fetchMemoFile(mediaId: string): Promise<string> {
  const file = new File(Paths.cache, `memo-${mediaId}.m4a`)
  if (!file.exists) {
    const res = await fetch(`${API_BASE_URL}/api/media/${mediaId}`, {
      credentials: 'include',
      headers: authHeaders(),
    })
    if (!res.ok) throw new Error(`memo fetch failed (${res.status})`)
    file.write(new Uint8Array(await res.arrayBuffer()))
  }
  return file.uri
}

/** Stateful mic recording → transcription. Drive a record button with `isRecording`/`start`/`stop`. */
export function useVoiceTranscriber() {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY)
  const [isRecording, setIsRecording] = useState(false)

  async function start(): Promise<boolean> {
    // Must request recording permission through expo-audio before record() — the OS prompt alone
    // isn't enough. Returns early (no crash) if denied.
    const { granted } = await AudioModule.requestRecordingPermissionsAsync()
    if (!granted) return false
    // iOS rejects allowsRecording without playsInSilentMode.
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true })
    await recorder.prepareToRecordAsync()
    recorder.record()
    setIsRecording(true)
    return true
  }

  /** Stop recording and return the transcript. */
  async function stop(): Promise<string> {
    await recorder.stop()
    // Release the recording claim so the session returns to playback (see useVoiceMemo.stop).
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true })
    setIsRecording(false)
    const uri = recorder.uri
    if (!uri) throw new Error('No recording captured')

    // Native multipart upload — avoids the RN Blob/FormData limitation ("Creating blobs from
    // ArrayBuffer not supported"). uploadAsync streams the file from disk on the native side.
    const result = await uploadAsync(`${API_BASE_URL}/api/voice/stt`, uri, {
      uploadType: FileSystemUploadType.MULTIPART,
      fieldName: 'file',
      mimeType: 'audio/m4a',
      headers: authHeaders(),
    })
    if (result.status !== 200) throw new Error(`STT failed (${result.status})`)
    const data = JSON.parse(result.body) as { text?: string }
    return data.text ?? ''
  }

  return { isRecording, start, stop }
}
