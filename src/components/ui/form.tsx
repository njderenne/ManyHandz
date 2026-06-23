import { createContext, useContext } from 'react'
import { View, type ViewProps } from 'react-native'
import { cn } from '@/lib/utils'

/**
 * Form — a field container that makes the Enter key submit, on web.
 *
 * Native has no "press Enter to submit": the on-screen keyboard's return key is a per-field affair,
 * so there's nothing to wire (and submitting a half-filled multi-field form on the first "return"
 * would be wrong). On WEB, though, every form is expected to submit when you press Enter in a field —
 * and React Native Web gives us nothing for free, because these inputs aren't inside an HTML <form>.
 *
 * So: wrap your fields AND submit button in <Form onSubmit={handleSubmit}>. Any single-line <Input>
 * rendered inside reads that handler from context and fires it on Enter (web only). Multiline
 * <Textarea> is exempt — there Enter means "newline". Pass the SAME handler you give the submit
 * Button's `onPress`, so mouse-click and Enter take identical paths.
 *
 * It's otherwise just a View (default `gap-4`) — style it like any container.
 */
const FormSubmitContext = createContext<(() => void) | undefined>(undefined)

/** Internal: <Input> reads this to fire the enclosing form's submit on Enter (web). */
export function useFormSubmit() {
  return useContext(FormSubmitContext)
}

export type FormProps = ViewProps & {
  /**
   * Called when a single-line field inside is submitted via the web Enter key. Pass the SAME
   * handler as your submit Button's `onPress` (e.g. react-hook-form's `handleSubmit(onValid)`).
   */
  onSubmit?: () => void
}

export function Form({ onSubmit, className, children, ...props }: FormProps) {
  return (
    <FormSubmitContext.Provider value={onSubmit}>
      <View className={cn('gap-4', className)} {...props}>
        {children}
      </View>
    </FormSubmitContext.Provider>
  )
}
