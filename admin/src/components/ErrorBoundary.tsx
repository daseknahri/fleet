import React, { Component, ErrorInfo, ReactNode } from 'react'
import { strings as commonStrings } from '@/lang/common'

interface Props {
  children?: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
}

class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false
  }

  // Update state so the next render shows the fallback UI.
  public static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // You can log the error to an external service here (like Sentry)
    console.error('Uncaught error:', error, errorInfo)
  }

  public render() {
    if (this.state.hasError) {
      // GAP-ADMIN-P0-1 — the boundary used to be a dead end: a failed
      // lazy chunk (e.g. a 429 on /chunks/*) left the tab on this
      // message with no way back short of a manual reload. Offer the
      // reload here; a custom fallback still wins when one is given.
      if (this.props.fallback) {
        return this.props.fallback
      }
      return (
        <div style={{ padding: 24 }}>
          <h2>{commonStrings.GENERIC_ERROR}</h2>
          <button type="button" onClick={() => window.location.reload()}>{commonStrings.RELOAD}</button>
        </div>
      )
    }

    return this.props.children
  }
}

export default ErrorBoundary
