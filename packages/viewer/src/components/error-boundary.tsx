import type { ErrorInfo, ReactNode } from 'react'
import { Component } from 'react'

export class ErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false }
  static getDerivedStateFromError() {
    return { hasError: true }
  }
  componentDidCatch(_e: Error, _i: ErrorInfo) {}
  render() {
    return this.state.hasError ? this.props.fallback : this.props.children
  }
}
