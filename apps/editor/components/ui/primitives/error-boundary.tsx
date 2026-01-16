'use client'

import React, { Component, ErrorInfo, ReactNode } from 'react'

interface Props {
  children?: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo)
  }

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }
      return (
        <div className="flex h-screen w-screen flex-col items-center justify-center bg-[#1b1c1f] p-4 text-white">
          <h2 className="mb-4 text-xl font-bold text-red-400">Something went wrong</h2>
          <pre className="max-w-full overflow-auto rounded bg-black/30 p-4 text-sm text-gray-300">
            {this.state.error?.message}
          </pre>
          <button
            className="mt-4 rounded bg-blue-600 px-4 py-2 hover:bg-blue-700"
            onClick={() => this.setState({ hasError: false, error: null })}
          >
            Try again
          </button>
        </div>
      )
    }

    return this.props.children
  }
}

