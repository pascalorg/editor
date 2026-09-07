'use client'

import type { ErrorInfo, ReactNode } from 'react'
import { Component } from 'react'

type Props = {
  children: ReactNode
  onExit: () => void
}

type State = {
  error: Error | null
}

export class XRRenderErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[editor/xr] Immersive render failed', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div className="flex h-screen w-screen items-center justify-center bg-zinc-950 p-6 text-white">
        <section className="w-full max-w-md rounded-2xl border border-red-400/20 bg-zinc-900 p-7 shadow-2xl">
          <p className="font-semibold text-red-300 text-sm">XR render error</p>
          <h1 className="mt-2 font-semibold text-xl">The immersive scene could not render</h1>
          <p className="mt-2 break-words text-sm text-zinc-400">
            {this.state.error.message || 'An unknown WebXR rendering error occurred.'}
          </p>
          <button
            className="mt-6 rounded-lg border border-white/15 px-4 py-2.5 font-medium text-sm hover:bg-white/5"
            onClick={this.props.onExit}
            type="button"
          >
            Exit VR test
          </button>
        </section>
      </div>
    )
  }
}
