import { useState, useRef, useEffect, useCallback } from 'react'

/**
 * useTimer — a simple count-up stopwatch hook (start/pause/reset). Counts whole seconds.
 * The basis for rest timers, session timers, etc. For countdowns, pass a target and subtract.
 */
export function useTimer(initialSeconds = 0) {
  const [seconds, setSeconds] = useState(initialSeconds)
  const [running, setRunning] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (running) {
      intervalRef.current = setInterval(() => setSeconds((s) => s + 1), 1000)
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [running])

  const start = useCallback(() => setRunning(true), [])
  const pause = useCallback(() => setRunning(false), [])
  const reset = useCallback(() => {
    setRunning(false)
    setSeconds(initialSeconds)
  }, [initialSeconds])

  return { seconds, running, start, pause, reset }
}

/** Format whole seconds as `MM:SS` (or `H:MM:SS` past an hour). */
export function formatDuration(totalSeconds: number): string {
  // Round to whole seconds first so a fractional input never renders ":60" or a decimal seconds field.
  const total = Math.round(totalSeconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}
