import { useState } from 'react'
import { Text } from '@/components/ui/text'

/**
 * Shared async-action state for the Services testers (dev gallery only). `useAsyncAction` wraps a
 * handler in try/catch and exposes idle/loading/ok/error; `Result` renders that state inline.
 */
export type AsyncState = { status: 'idle' | 'loading' | 'ok' | 'error'; message?: string }

export function useAsyncAction() {
  const [state, setState] = useState<AsyncState>({ status: 'idle' })
  async function run(fn: () => Promise<string | void>) {
    setState({ status: 'loading' })
    try {
      const r = await fn()
      setState({ status: 'ok', message: typeof r === 'string' ? r : 'Done' })
    } catch (e) {
      setState({ status: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  }
  return { state, run }
}

export function Result({ state }: { state: AsyncState }) {
  if (state.status === 'idle') return null
  if (state.status === 'loading') return <Text variant="caption">Running…</Text>
  return (
    <Text variant="caption" className={state.status === 'ok' ? 'text-success' : 'text-destructive'}>
      {state.message}
    </Text>
  )
}
