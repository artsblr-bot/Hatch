import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
  info: ErrorInfo | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null, info: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, info: null }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ error, info })
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', error, info)
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, info: null })
  }

  handleHardReset = () => {
    try {
      localStorage.clear()
    } catch {}
    location.href = location.origin + location.pathname
  }

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <div className="grid min-h-screen place-items-center bg-bg px-6 text-fg">
        <div className="max-w-md rounded-3xl border border-border bg-bg-subtle/40 p-8 shadow-soft">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-danger/15 text-danger">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <h1 className="mt-5 font-serif text-2xl font-medium tracking-tight">Something went wrong.</h1>
          <p className="mt-1.5 text-sm text-fg-muted">
            The app crashed. Your data is still safe in IndexedDB.
          </p>
          {this.state.error && (
            <pre className="mt-4 max-h-48 overflow-auto rounded-xl border border-border bg-bg p-3 font-mono text-[11px] text-fg-muted">
              {this.state.error.message}
              {'\n'}
              {this.state.error.stack?.split('\n').slice(0, 6).join('\n')}
            </pre>
          )}
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <button
              onClick={this.handleReset}
              className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition hover:shadow-glow focus-ring"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Try again
            </button>
            <button
              onClick={this.handleHardReset}
              className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-bg-subtle px-4 py-2 text-sm text-fg-muted transition hover:bg-bg-muted focus-ring"
            >
              Reset app
            </button>
          </div>
          <p className="mt-3 text-[11px] text-fg-subtle">
            "Reset app" clears local cache. Your encrypted IndexedDB data is preserved.
          </p>
        </div>
      </div>
    )
  }
}
