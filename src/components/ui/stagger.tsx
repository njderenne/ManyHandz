import { Children } from 'react'
import { View, type ViewProps } from 'react-native'
import { FadeIn } from './fade-in'

/**
 * Stagger — wrap a list of children to make them fade/slide in one after another. Use for screen
 * content, lists, and onboarding so things arrive with a cascade instead of all at once.
 */
export function Stagger({
  children,
  delay = 0,
  step = 80,
  ...props
}: ViewProps & { delay?: number; step?: number }) {
  return (
    <View {...props}>
      {Children.toArray(children).map((child, i) => (
        <FadeIn key={i} delay={delay + i * step}>
          {child}
        </FadeIn>
      ))}
    </View>
  )
}
