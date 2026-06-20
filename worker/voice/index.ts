import type { Env } from '../env'

/**
 * Voice — ElevenLabs text-to-speech + speech-to-text (Scribe), via the REST API (Worker-safe raw
 * fetch; no SDK/bundle cost). Keys are Worker secrets. Voice + models are env-overridable.
 *
 *   tts(text)        → audio (audio/mpeg) — streamed straight back to the client
 *   transcribe(file) → transcript text
 */
const BASE = 'https://api.elevenlabs.io/v1'
const DEFAULTS = {
  voice: '21m00Tcm4TlvDq8ikWAM', // a stock ElevenLabs voice; override via ELEVENLABS_VOICE_ID
  ttsModel: 'eleven_multilingual_v2',
  sttModel: 'scribe_v1',
}

export function createVoice(env: Env) {
  const key = env.ELEVENLABS_API_KEY ?? ''

  return {
    /** Text → speech. Returns the raw upstream Response so the route can stream the audio back. */
    tts(text: string, opts: { voiceId?: string; model?: string } = {}): Promise<Response> {
      const voiceId = opts.voiceId ?? env.ELEVENLABS_VOICE_ID ?? DEFAULTS.voice
      // The route layer validates the shape; encoding here is defense in depth — the id lands in
      // a URL path on a request that carries the secret api key, so it must never steer the path.
      return fetch(`${BASE}/text-to-speech/${encodeURIComponent(voiceId)}`, {
        method: 'POST',
        headers: { 'xi-api-key': key, 'content-type': 'application/json' },
        body: JSON.stringify({
          text,
          model_id: opts.model ?? env.ELEVENLABS_TTS_MODEL ?? DEFAULTS.ttsModel,
        }),
      })
    },

    /** Speech → text. Forwards the audio to Scribe and returns the transcript. */
    async transcribe(audio: Blob, opts: { model?: string } = {}): Promise<string> {
      const form = new FormData()
      form.append('file', audio)
      form.append('model_id', opts.model ?? env.ELEVENLABS_STT_MODEL ?? DEFAULTS.sttModel)
      const res = await fetch(`${BASE}/speech-to-text`, {
        method: 'POST',
        headers: { 'xi-api-key': key },
        body: form,
      })
      if (!res.ok) throw new Error(`ElevenLabs STT failed: ${res.status}`)
      const data = (await res.json()) as { text?: string }
      return data.text ?? ''
    },
  }
}

export type Voice = ReturnType<typeof createVoice>
