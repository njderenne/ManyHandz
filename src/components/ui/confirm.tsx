import { createContext, useCallback, useContext, useRef, useState } from 'react'
import { View } from 'react-native'
import { Dialog } from './dialog'
import { Button } from './button'

/**
 * Confirm — the in-app replacement for native confirmations.
 *
 * NEVER use `Alert.alert` or `window.confirm` for "are you sure?" prompts. On web `Alert.alert` is a
 * no-op and `window.confirm` renders the browser's ugly, unthemeable "<host> says…" dialog; on native
 * `Alert` looks nothing like the app. Both block the JS thread and can't be styled. Instead wrap the
 * app in <ConfirmProvider> (done in app/_layout.tsx) and call the promise-based hook:
 *
 *   const confirm = useConfirm()
 *   const ok = await confirm({ title: 'Delete this?', message: 'This cannot be undone.', destructive: true })
 *   if (ok) doDelete()
 *
 * It renders a single themed <Dialog> with Cancel + Confirm. Dismissing (backdrop / ✕ / native
 * flick-down) resolves `false`. `destructive` styles the confirm button red for delete/discard.
 */
export type ConfirmOptions = {
  title: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  /** Style the confirm button as destructive (red) — for delete / discard / remove. */
  destructive?: boolean
}

const ConfirmContext = createContext<((opts: ConfirmOptions) => Promise<boolean>) | null>(null)

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null)
  // The pending promise's resolver lives in a ref so closing never depends on a state updater's
  // side effect (which StrictMode could double-invoke).
  const resolveRef = useRef<((ok: boolean) => void) | null>(null)

  const confirm = useCallback(
    (next: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        // A second confirm() while one is open: resolve the previous as cancelled, then show the new.
        resolveRef.current?.(false)
        resolveRef.current = resolve
        setOpts(next)
      }),
    [],
  )

  const close = useCallback((ok: boolean) => {
    resolveRef.current?.(ok)
    resolveRef.current = null
    setOpts(null)
  }, [])

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog
        visible={opts !== null}
        onClose={() => close(false)}
        title={opts?.title}
        description={opts?.message}
      >
        <View className="flex-row justify-end gap-2 pt-2">
          <Button variant="outline" label={opts?.cancelLabel ?? 'Cancel'} onPress={() => close(false)} />
          <Button
            variant={opts?.destructive ? 'destructive' : 'default'}
            label={opts?.confirmLabel ?? 'Confirm'}
            onPress={() => close(true)}
          />
        </View>
      </Dialog>
    </ConfirmContext.Provider>
  )
}

/** Promise-based confirmation. Must be called under a <ConfirmProvider>. Returns true on confirm. */
export function useConfirm() {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm must be used within a ConfirmProvider')
  return ctx
}
