import type { ErrorInfo, ReactNode } from 'react'
import { Component } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
  fallback: ReactNode
  /** Tag for log lines so we can tell which boundary swallowed an error. */
  scope?: string
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, { hasError: boolean }> {
  override state = { hasError: false }
  static getDerivedStateFromError() {
    return { hasError: true }
  }
  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(
      `[viewer] ErrorBoundary caught${this.props.scope ? ` (${this.props.scope})` : ''}:`,
      error,
      info.componentStack,
    )
  }
  override render() {
    return this.state.hasError ? this.props.fallback : this.props.children
  }
}
