import { createContext, useCallback, useContext, useRef, useState } from 'react'
import { View, StyleSheet, Pressable } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { MotiView, AnimatePresence } from 'moti'
import { CircleCheck, CircleX, Info } from 'lucide-react-native'
import { useColors } from '@/lib/config/theme'
import { Text } from './text'

/**
 * Toast — transient notifications. Wrap the app in <ToastProvider> (done in app/_layout.tsx),
 * then call `const { toast } = useToast()` and `toast({ title, variant })`. Auto-dismisses.
 * Pass `action: { label, onPress }` for an inline button (e.g. "Undo") — action toasts linger
 * longer, and tapping the action dismisses the toast.
 *
 * (A heavier library like sonner-native/burnt can replace this later; the call site stays the same.)
 */
type ToastVariant = 'default' | 'success' | 'error'
type ToastAction = { label: string; onPress: () => void }
type ToastItem = {
  id: string
  title: string
  description?: string
  variant: ToastVariant
  action?: ToastAction
}

const ToastContext = createContext<{ toast: (t: Omit<ToastItem, 'id' | 'variant'> & { variant?: ToastVariant }) => void } | null>(
  null,
)

// Icon per variant; the color is a palette token so it flips with the theme (resolved in render).
const ICONS = {
  default: { Icon: Info, token: 'brand' },
  success: { Icon: CircleCheck, token: 'success' },
  error: { Icon: CircleX, token: 'destructive' },
} as const

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const colors = useColors()
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const idRef = useRef(0)

  const toast = useCallback<NonNullable<React.ContextType<typeof ToastContext>>['toast']>((t) => {
    const id = String(++idRef.current)
    setToasts((prev) => [...prev, { variant: 'default', ...t, id }])
    // Give action toasts longer on screen — the user has a decision to make.
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), t.action ? 6000 : 3200)
  }, [])

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((x) => x.id !== id))
  }, [])

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <SafeAreaView pointerEvents="box-none" style={StyleSheet.absoluteFill} edges={['top']}>
        {/* max-w keeps toasts card-sized on wide viewports (no-op on phones, where the screen is narrower). */}
        <View pointerEvents="box-none" className="w-full max-w-md self-center gap-2 p-4">
          <AnimatePresence>
            {toasts.map((t) => {
              const { Icon, token } = ICONS[t.variant]
              return (
                <MotiView
                  key={t.id}
                  from={{ opacity: 0, translateY: -16 }}
                  animate={{ opacity: 1, translateY: 0 }}
                  exit={{ opacity: 0, translateY: -16 }}
                  transition={{ type: 'timing', duration: 220 }}
                >
                  <View className="flex-row items-center gap-3 rounded-lg border border-border bg-card p-3">
                    <Icon color={colors[token]} size={20} />
                    <View className="flex-1 gap-0.5">
                      <Text variant="label">{t.title}</Text>
                      {t.description ? <Text variant="muted">{t.description}</Text> : null}
                    </View>
                    {t.action ? (
                      <Pressable
                        onPress={() => {
                          dismiss(t.id)
                          try {
                            t.action?.onPress()
                          } catch {
                            // an action handler must never crash the toast layer
                          }
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={t.action.label}
                        hitSlop={8}
                        className="rounded-md border border-border px-2.5 py-1.5 active:scale-95 active:bg-accent"
                      >
                        <Text variant="label" className="text-primary">
                          {t.action.label}
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                </MotiView>
              )
            })}
          </AnimatePresence>
        </View>
      </SafeAreaView>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within a ToastProvider')
  return ctx
}
