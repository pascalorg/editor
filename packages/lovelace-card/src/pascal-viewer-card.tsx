import { StrictMode, useEffect, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { loadPascalLovelaceArtifact } from './artifact'
import { PascalViewerRuntime } from './pascal-viewer-runtime'
import type {
  HomeAssistantLike,
  PascalLovelaceSceneArtifact,
  PascalViewerCardConfig,
} from './types'

const CARD_TAG = 'pascal-viewer-card'

declare global {
  interface Window {
    customCards?: Array<{
      description?: string
      documentationURL?: string
      name: string
      preview?: boolean
      type: string
    }>
  }
}

function PascalViewerCardApp({
  config,
  eventTarget,
  hass,
}: {
  config: PascalViewerCardConfig
  eventTarget: HTMLElement
  hass: HomeAssistantLike | null
}) {
  const [artifact, setArtifact] = useState<PascalLovelaceSceneArtifact | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setError(null)
    setArtifact(null)

    loadPascalLovelaceArtifact(config.scene, config.scene_url)
      .then((nextArtifact) => {
        if (!cancelled) {
          setArtifact(nextArtifact)
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Failed to load scene.')
        }
      })

    return () => {
      cancelled = true
    }
  }, [config.scene, config.scene_url])

  if (error) {
    return (
      <div style={errorStyle}>
        <strong>Pascal scene could not load.</strong>
        <span>{error}</span>
      </div>
    )
  }

  if (!artifact) {
    return <div style={loadingStyle}>Loading Pascal scene...</div>
  }

  return (
    <PascalViewerRuntime
      artifact={artifact}
      config={config}
      eventTarget={eventTarget}
      hass={hass}
    />
  )
}

const loadingStyle: React.CSSProperties = {
  alignItems: 'center',
  background: 'var(--ha-card-background, var(--card-background-color, #111827))',
  borderRadius: 'var(--ha-card-border-radius, 12px)',
  color: 'var(--primary-text-color, #fff)',
  display: 'flex',
  fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif',
  fontSize: 13,
  justifyContent: 'center',
  minHeight: 280,
  padding: 16,
}

const errorStyle: React.CSSProperties = {
  ...loadingStyle,
  alignItems: 'flex-start',
  color: 'var(--error-color, #fca5a5)',
  flexDirection: 'column',
  gap: 8,
  justifyContent: 'center',
}

class PascalViewerCard extends HTMLElement {
  private config: PascalViewerCardConfig | null = null
  private hassValue: HomeAssistantLike | null = null
  private mount: HTMLDivElement
  private root: Root | null = null

  constructor() {
    super()
    const shadow = this.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    style.textContent = `
      :host {
        display: block;
        height: 100%;
        min-height: 0;
      }
      * {
        box-sizing: border-box;
      }
      canvas {
        display: block;
      }
    `
    this.mount = document.createElement('div')
    this.mount.style.height = '100%'
    this.mount.style.minHeight = '0'
    shadow.append(style, this.mount)
  }

  setConfig(config: PascalViewerCardConfig) {
    if (!(config?.scene_url || config?.scene)) {
      throw new Error('Pascal Viewer Card requires scene_url or an inline scene artifact.')
    }

    this.config = {
      mode: 'overview',
      renderer: 'auto',
      show_floor_selector: true,
      show_header: true,
      tap_action: { action: 'toggle' },
      view_mode: '3d',
      ...config,
    }
    this.renderCard()
  }

  set hass(hass: HomeAssistantLike) {
    this.hassValue = hass
    this.renderCard()
  }

  getCardSize() {
    if (this.config?.mode === 'compact') {
      return 3
    }
    if (this.config?.mode === 'room') {
      return 5
    }
    return 8
  }

  getGridOptions() {
    if (this.config?.mode === 'compact') {
      return { columns: 6, min_columns: 4, min_rows: 3, rows: 4 }
    }
    if (this.config?.mode === 'room') {
      return { columns: 12, min_columns: 6, min_rows: 5, rows: 6 }
    }
    return { columns: 12, min_columns: 8, min_rows: 7, rows: 8 }
  }

  disconnectedCallback() {
    this.root?.unmount()
    this.root = null
  }

  private renderCard() {
    if (!this.config) {
      return
    }

    this.root = this.root ?? createRoot(this.mount)
    this.root.render(
      <StrictMode>
        <PascalViewerCardApp
          config={this.config}
          eventTarget={this}
          hass={this.hassValue}
        />
      </StrictMode>,
    )
  }

  static getStubConfig(): PascalViewerCardConfig {
    return {
      mode: 'overview',
      scene_url: '/local/pascal/home.scene.json',
      show_header: true,
      type: `custom:${CARD_TAG}`,
    }
  }

  static getConfigForm() {
    return {
      schema: [
        { name: 'scene_url', required: true, selector: { text: {} } },
        {
          name: 'mode',
          selector: {
            select: {
              mode: 'dropdown',
              options: [
                { label: 'Overview', value: 'overview' },
                { label: 'Room', value: 'room' },
                { label: 'Compact', value: 'compact' },
              ],
            },
          },
        },
        { name: 'room', selector: { text: {} } },
        { name: 'default_level', selector: { text: {} } },
        {
          name: 'view_mode',
          selector: {
            select: {
              mode: 'dropdown',
              options: [
                { label: '3D', value: '3d' },
                { label: '2D', value: '2d' },
              ],
            },
          },
        },
        { name: 'show_header', selector: { boolean: {} } },
      ],
    }
  }
}

if (!customElements.get(CARD_TAG)) {
  customElements.define(CARD_TAG, PascalViewerCard)
}

window.customCards = window.customCards || []
if (!window.customCards.some((card) => card.type === CARD_TAG)) {
  window.customCards.push({
    type: CARD_TAG,
    name: 'Pascal Viewer',
    preview: false,
    description: 'Render a Pascal smart-home viewer scene inside Lovelace.',
  })
}
