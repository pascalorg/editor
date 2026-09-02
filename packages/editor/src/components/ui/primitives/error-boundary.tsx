'use client'

import React, { Component, type ErrorInfo, type ReactNode } from 'react'
import { useTranslations } from '../../../lib/i18n'

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
        <ErrorBoundaryFallback
          errorMessage={this.state.error?.message}
          onReset={() => this.setState({ hasError: false, error: null })}
        />
      )
    }

    return this.props.children
  }
}

function ErrorBoundaryFallback({
  errorMessage,
  onReset,
}: {
  errorMessage?: string
  onReset: () => void
}) {
  const t = useTranslations()
  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center bg-[#1b1c1f] p-4 text-white">
      <h2 className="mb-4 font-bold text-red-400 text-xl">{t('editor.somethingWentWrong')}</h2>
      <pre className="max-w-full overflow-auto rounded bg-black/30 p-4 text-gray-300 text-sm">
        {errorMessage}
      </pre>
      <button
        className="mt-4 rounded bg-blue-600 px-4 py-2 hover:bg-blue-700"
        onClick={onReset}
      >
        {t('editor.tryAgain')}
      </button>
    </div>
  )
}
