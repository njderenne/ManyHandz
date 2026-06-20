import { Component, type ReactNode } from 'react'
import { View } from 'react-native'
import { TriangleAlert } from 'lucide-react-native'
import { EmptyState } from './empty-state'
import { Button } from './button'

/**
 * ErrorBoundary — catches render-time crashes and shows a recoverable fallback instead of a white
 * screen. Wrap screens (or the app). Hook `onError` to Sentry. React error boundaries must be class
 * components.
 */
type Props = { children: ReactNode; fallback?: ReactNode; onError?: (error: Error) => void }
type State = { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error) {
    this.props.onError?.(error)
  }

  reset = () => this.setState({ error: null })

  render() {
    if (this.state.error) {
      return (
        this.props.fallback ?? (
          <View className="flex-1 items-center justify-center bg-background">
            <EmptyState
              icon={TriangleAlert}
              title="Something broke"
              description={this.state.error.message}
              action={<Button label="Try again" onPress={this.reset} />}
            />
          </View>
        )
      )
    }
    return this.props.children
  }
}
