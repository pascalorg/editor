'use client'

import { AlertTriangle, RotateCcw } from 'lucide-react'
import { Component, type ErrorInfo, type ReactNode } from 'react'

interface PluginErrorBoundaryProps {
  children: ReactNode
  pluginName?: string
  onReset?: () => void
}

interface PluginErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

export class PluginErrorBoundary extends Component<
  PluginErrorBoundaryProps,
  PluginErrorBoundaryState
> {
  constructor(props: PluginErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): PluginErrorBoundaryState {
    return { hasError: true, error }
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error(
      `[PluginErrorBoundary] Error rendering ${this.props.pluginName ?? 'plugin'}:`,
      error,
      errorInfo,
    )
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null })
    this.props.onReset?.()
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-5 text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-rose-500/20 text-rose-400">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div>
            <h4 className="font-semibold text-foreground text-sm">
              {this.props.pluginName ? `"${this.props.pluginName}" Yüklenemedi` : 'Eklenti Hatası'}
            </h4>
            <p className="mt-1 text-muted-foreground text-xs">
              {this.state.error?.message || 'Bileşen render edilirken beklenmeyen bir hata oluştu.'}
            </p>
          </div>
          <button
            className="mt-1 inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 font-medium text-foreground text-xs shadow-sm hover:bg-accent"
            onClick={this.handleReset}
            type="button"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Yeniden Dene
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
