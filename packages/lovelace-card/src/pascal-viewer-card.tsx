import { StrictMode, useEffect, useState, useSyncExternalStore } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { applyPascalViewerCardHomeAssistantConfig, loadPascalLovelaceArtifact } from './artifact'
import { PascalViewerRuntime } from './pascal-viewer-runtime'
import type {
  HomeAssistantLike,
  PascalLovelaceSceneArtifact,
  PascalViewerCardConfig,
} from './types'

const CARD_TAG = 'pascal-viewer-card'

function getModuleScopedEditorTag() {
  let hash = 0
  for (const character of import.meta.url || CARD_TAG) {
    hash = (hash * 31 + character.charCodeAt(0)) | 0
  }
  return `pascal-viewer-card-editor-${Math.abs(hash).toString(36)}`
}

const CARD_EDITOR_TAG = getModuleScopedEditorTag()
const editorActivityListeners = new Set<() => void>()
let activeEditorCount = 0

type PascalViewerCardConstructor = CustomElementConstructor & {
  getConfigElement?: () => HTMLElement | Promise<HTMLElement>
  getStubConfig?: () => PascalViewerCardConfig
}

function getDefaultCardConfig(config: PascalViewerCardConfig): PascalViewerCardConfig {
  return {
    mode: 'overview',
    renderer: 'auto',
    show_floor_selector: true,
    show_header: true,
    tap_action: { action: 'toggle' },
    view_mode: '3d',
    ...config,
  }
}

function getDefaultEditorConfig(config: PascalViewerCardConfig): PascalViewerCardConfig {
  return {
    ...getDefaultCardConfig(config),
    scene_url:
      config.scene || config.scene_url ? config.scene_url : '/local/pascal/home.scene.json',
  }
}

function serializeConfig(config: PascalViewerCardConfig) {
  try {
    return JSON.stringify(config)
  } catch {
    return null
  }
}

function emitEditorActivityChange() {
  for (const listener of editorActivityListeners) {
    listener()
  }
}

function subscribeEditorActivity(listener: () => void) {
  editorActivityListeners.add(listener)
  return () => {
    editorActivityListeners.delete(listener)
  }
}

function getEditorActiveSnapshot() {
  return activeEditorCount > 0
}

function updateEditorActivity(delta: 1 | -1) {
  activeEditorCount = Math.max(0, activeEditorCount + delta)
  emitEditorActivityChange()
}

function useEditorActive() {
  return useSyncExternalStore(
    subscribeEditorActivity,
    getEditorActiveSnapshot,
    getEditorActiveSnapshot,
  )
}

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
  editMode = false,
  eventTarget,
  hass,
  onConfigChange,
}: {
  config: PascalViewerCardConfig
  editMode?: boolean
  eventTarget: HTMLElement
  hass: HomeAssistantLike | null
  onConfigChange?: (config: PascalViewerCardConfig) => void
}) {
  const [artifact, setArtifact] = useState<PascalLovelaceSceneArtifact | null>(null)
  const [error, setError] = useState<string | null>(null)
  const editorPreviewSuppressed = useEditorActive() && !editMode

  useEffect(() => {
    let cancelled = false
    setError(null)
    setArtifact(null)

    if (editorPreviewSuppressed) {
      return () => {
        cancelled = true
      }
    }

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
  }, [config.scene, config.scene_url, editorPreviewSuppressed])

  if (editorPreviewSuppressed) {
    return <PascalViewerCardPreviewPaused />
  }

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
      editMode={editMode}
      eventTarget={eventTarget}
      hass={hass}
      onHomeAssistantConfigChange={(homeAssistantConfig) => {
        const nextConfig: PascalViewerCardConfig = {
          ...config,
          home_assistant: homeAssistantConfig,
        }
        if (config.scene) {
          nextConfig.scene = applyPascalViewerCardHomeAssistantConfig(artifact, nextConfig)
        }
        onConfigChange?.({
          ...nextConfig,
        })
      }}
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

const pausedPreviewStyle: React.CSSProperties = {
  ...loadingStyle,
  alignItems: 'stretch',
  background: 'var(--ha-card-background, var(--card-background-color, #151515))',
  justifyContent: 'flex-start',
  minHeight: 180,
  padding: 0,
}

function PascalViewerCardPreviewPaused() {
  return (
    <div style={pausedPreviewStyle}>
      <div
        style={{
          alignItems: 'center',
          display: 'flex',
          justifyContent: 'space-between',
          minHeight: 40,
          padding: '8px 12px',
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 700 }}>Pascal</div>
        <div style={{ color: '#86efac', fontSize: 11, fontWeight: 700 }}>Editing</div>
      </div>
    </div>
  )
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

    this.config = getDefaultCardConfig(config)
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
        <PascalViewerCardApp config={this.config} eventTarget={this} hass={this.hassValue} />
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

  static getConfigElement() {
    return document.createElement(CARD_EDITOR_TAG)
  }
}

class PascalViewerCardEditor extends HTMLElement {
  private config: PascalViewerCardConfig | null = null
  private editorActivityRegistered = false
  private hassValue: HomeAssistantLike | null = null
  private lastEmittedConfigKey: string | null = null
  private mount: HTMLDivElement
  private root: Root | null = null

  constructor() {
    super()
    const shadow = this.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    style.textContent = `
      :host {
        display: block;
        min-height: 520px;
      }
      * {
        box-sizing: border-box;
      }
      canvas {
        display: block;
      }
    `
    this.mount = document.createElement('div')
    this.mount.style.height = 'min(72vh, 720px)'
    this.mount.style.minHeight = '520px'
    shadow.append(style, this.mount)
  }

  connectedCallback() {
    this.registerEditorActivity()
  }

  setConfig(config: PascalViewerCardConfig) {
    const nextConfig = getDefaultEditorConfig(config)
    const nextConfigKey = serializeConfig(nextConfig)
    if (this.root && this.lastEmittedConfigKey && nextConfigKey === this.lastEmittedConfigKey) {
      return
    }

    this.config = nextConfig
    this.lastEmittedConfigKey = null
    this.renderEditor()
  }

  set hass(hass: HomeAssistantLike) {
    this.hassValue = hass
    this.renderEditor()
  }

  disconnectedCallback() {
    this.unregisterEditorActivity()
    this.root?.unmount()
    this.root = null
  }

  private registerEditorActivity() {
    if (this.editorActivityRegistered) {
      return
    }

    this.editorActivityRegistered = true
    updateEditorActivity(1)
  }

  private unregisterEditorActivity() {
    if (!this.editorActivityRegistered) {
      return
    }

    this.editorActivityRegistered = false
    updateEditorActivity(-1)
  }

  private handleConfigChange = (config: PascalViewerCardConfig) => {
    this.lastEmittedConfigKey = serializeConfig(config)
    this.dispatchEvent(
      new CustomEvent('config-changed', {
        bubbles: true,
        composed: true,
        detail: { config },
      }),
    )
  }

  private renderEditor() {
    if (!this.config) {
      return
    }

    this.root = this.root ?? createRoot(this.mount)
    this.root.render(
      <StrictMode>
        <PascalViewerCardApp
          config={this.config}
          editMode
          eventTarget={this}
          hass={this.hassValue}
          onConfigChange={this.handleConfigChange}
        />
      </StrictMode>,
    )
  }
}

function installPascalCardEditorHooks(cardConstructor: PascalViewerCardConstructor) {
  cardConstructor.getConfigElement = PascalViewerCard.getConfigElement
  cardConstructor.getStubConfig = PascalViewerCard.getStubConfig
}

const registeredCardConstructor = customElements.get(CARD_TAG) as
  | PascalViewerCardConstructor
  | undefined

if (registeredCardConstructor) {
  installPascalCardEditorHooks(registeredCardConstructor)
} else {
  customElements.define(CARD_TAG, PascalViewerCard)
  installPascalCardEditorHooks(PascalViewerCard)
}

if (!customElements.get(CARD_EDITOR_TAG)) {
  customElements.define(CARD_EDITOR_TAG, PascalViewerCardEditor)
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
