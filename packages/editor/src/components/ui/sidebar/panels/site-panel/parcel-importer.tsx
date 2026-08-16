import { type LonLat, useScene, type SiteNode } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Loader2, MapPin } from 'lucide-react'
import { useContext, useEffect, useState } from 'react'
import { ParcelProviderContext } from '../../../../../lib/parcel-provider-context'
import type { ParcelResult } from '../../../../../lib/parcel-provider'
import { LocationMap } from '../../../panels/sun-study/location-map'
import { LocalizedContent, useTranslation } from '../../../../../lib/i18n'
import { cn } from '../../../../../lib/utils'
import { PanelSection } from '../../../controls/panel-section'
import { ActionButton, ActionGroup } from '../../../controls/action-button'
import { formatAreaLabel } from '../../../../../lib/measurements'

// Minimal bounding box logic to center the polygon.
function calculatePolygonArea(polygon: Array<[number, number]>): number {
  if (polygon.length < 3) return 0
  let area = 0
  const n = polygon.length
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const [currentX, currentY] = polygon[i]!
    const [nextX, nextY] = polygon[j]!
    area += currentX * nextY
    area -= nextX * currentY
  }
  return Math.abs(area) / 2
}

export function ParcelImporter({ siteNode }: { siteNode: SiteNode }) {
  const provider = useContext(ParcelProviderContext)
  const t = useTranslation()
  const updateNode = useScene((state) => state.updateNode)
  const unit = useViewer((state) => state.unit)

  const [mode, setMode] = useState<'map' | 'form'>('map')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ParcelResult | null>(null)

  // Map state
  const [latitude, setLatitude] = useState<number | undefined>(
    siteNode.latitude ?? 41.0082
  )
  const [longitude, setLongitude] = useState<number | undefined>(
    siteNode.longitude ?? 28.9784
  )

  // Form state
  const [iller, setIller] = useState<{ id: number; name: string }[]>([])
  const [ilceler, setIlceler] = useState<{ id: number; name: string }[]>([])
  const [mahalleler, setMahalleler] = useState<{ id: number; name: string }[]>([])
  const [ilId, setIlId] = useState<number | ''>('')
  const [ilceId, setIlceId] = useState<number | ''>('')
  const [mahalleId, setMahalleId] = useState<number | ''>('')
  const [ada, setAda] = useState('')
  const [parsel, setParsel] = useState('')

  useEffect(() => {
    if (!provider?.regions || mode !== 'form') return
    const controller = new AbortController()
    provider.regions.getIller(controller.signal).then(setIller).catch(() => {})
    return () => controller.abort()
  }, [provider, mode])

  useEffect(() => {
    if (!provider?.regions || !ilId || mode !== 'form') return
    const controller = new AbortController()
    provider.regions.getIlceler(ilId, controller.signal).then(setIlceler).catch(() => {})
    return () => controller.abort()
  }, [provider, ilId, mode])

  useEffect(() => {
    if (!provider?.regions || !ilceId || mode !== 'form') return
    const controller = new AbortController()
    provider.regions.getMahalleler(ilceId, controller.signal).then(setMahalleler).catch(() => {})
    return () => controller.abort()
  }, [provider, ilceId, mode])

  if (!provider) return null

  const handleSearchMap = async (pos: LonLat) => {
    setLatitude(pos.latitude)
    setLongitude(pos.longitude)
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res = await provider.search({
        kind: 'point',
        latitude: pos.latitude,
        longitude: pos.longitude
      })
      if (!res) {
        setError(t('No parcel found at this location.'))
      } else {
        setResult(res)
      }
    } catch (e: any) {
      setError(e.message || t('Error fetching parcel'))
    } finally {
      setLoading(false)
    }
  }

  const handleSearchForm = async () => {
    if (!mahalleId || !ada || !parsel) return
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res = await provider.search({
        kind: 'administrative',
        mahalleId: Number(mahalleId),
        ada,
        parsel
      })
      if (!res) {
        setError(t('Parcel not found.'))
      } else {
        setResult(res)
      }
    } catch (e: any) {
      setError(e.message || t('Error fetching parcel'))
    } finally {
      setLoading(false)
    }
  }

  const handleApply = () => {
    if (!result) return

    // Convert geographic coordinates (LonLat) to local WebGL coordinates
    // We assume the first point of the ring is the origin (0,0) in our local space.
    // 1 degree latitude ~= 111.32km. 1 degree longitude ~= 111.32km * cos(latitude).
    const origin = result.ring[0]
    if (!origin) return

    const DEG_TO_RAD = Math.PI / 180
    const R_EARTH = 6378137 // meters

    const localPoints: Array<[number, number]> = result.ring.map(p => {
      const dy = (p.latitude - origin.latitude) * DEG_TO_RAD * R_EARTH
      const dx = (p.longitude - origin.longitude) * DEG_TO_RAD * R_EARTH * Math.cos(origin.latitude * DEG_TO_RAD)
      // We map local x -> dx, local z -> -dy (since Z is usually up/down in 3D but standard mapping differs, let's keep X and Z standard)
      return [dx, -dy]
    })

    // To center the polygon around (0,0), we find the bounding box
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity
    for (const [x, z] of localPoints) {
      minX = Math.min(minX, x)
      minZ = Math.min(minZ, z)
      maxX = Math.max(maxX, x)
      maxZ = Math.max(maxZ, z)
    }

    const cx = (minX + maxX) / 2
    const cz = (minZ + maxZ) / 2
    const centeredPoints: Array<[number, number]> = localPoints.map(([x, z]) => [x - cx, z - cz])

    const parts = result.label.split(' / ')
    
    updateNode(siteNode.id, {
      latitude: origin.latitude,
      longitude: origin.longitude,
      polygon: { type: 'polygon', points: centeredPoints },
      parcel: {
        source: 'tkgm',
        edited: false,
        registeredArea: result.registeredAreaRaw ? Number(result.registeredAreaRaw) : undefined,
        ada: parts[3]?.split(' ')[0] || '',
        parsel: parts[3]?.split(' ')[2] || '',
        il: parts[0] || '',
        ilce: parts[1] || '',
        mahalle: parts[2] || '',
        mahalleId: Number(mahalleId) || 0,
        nitelik: result.attributes?.nitelik,
        pafta: result.attributes?.pafta,
        fetchedAt: new Date().toISOString(),
      }
    })

    setResult(null) // Hide after applying
  }

  const renderForm = () => (
    <div className="flex flex-col gap-2 px-3 pb-2 text-xs">
      <div className="flex flex-col gap-1">
        <label className="text-muted-foreground">{t('İl')}</label>
        <select 
          className="rounded border border-border/50 bg-foreground/5 p-1 text-foreground"
          value={ilId}
          onChange={(e) => { setIlId(Number(e.target.value) || ''); setIlceId(''); setMahalleId('') }}
        >
          <option value="">{t('Seçiniz...')}</option>
          {iller.map(il => <option key={il.id} value={il.id}>{il.name}</option>)}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-muted-foreground">{t('İlçe')}</label>
        <select 
          className="rounded border border-border/50 bg-foreground/5 p-1 text-foreground disabled:opacity-50"
          value={ilceId}
          disabled={!ilId}
          onChange={(e) => { setIlceId(Number(e.target.value) || ''); setMahalleId('') }}
        >
          <option value="">{t('Seçiniz...')}</option>
          {ilceler.map(ilce => <option key={ilce.id} value={ilce.id}>{ilce.name}</option>)}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-muted-foreground">{t('Mahalle')}</label>
        <select 
          className="rounded border border-border/50 bg-foreground/5 p-1 text-foreground disabled:opacity-50"
          value={mahalleId}
          disabled={!ilceId}
          onChange={(e) => setMahalleId(Number(e.target.value) || '')}
        >
          <option value="">{t('Seçiniz...')}</option>
          {mahalleler.map(mah => <option key={mah.id} value={mah.id}>{mah.name}</option>)}
        </select>
      </div>
      <div className="flex gap-2">
        <div className="flex flex-col gap-1 flex-1">
          <label className="text-muted-foreground">{t('Ada')}</label>
          <input 
            className="w-full rounded border border-border/50 bg-foreground/5 p-1 text-foreground"
            value={ada}
            onChange={(e) => setAda(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1 flex-1">
          <label className="text-muted-foreground">{t('Parsel')}</label>
          <input 
            className="w-full rounded border border-border/50 bg-foreground/5 p-1 text-foreground"
            value={parsel}
            onChange={(e) => setParsel(e.target.value)}
          />
        </div>
      </div>
      <ActionGroup className="mt-2">
        <ActionButton 
          disabled={!mahalleId || !ada || !parsel || loading} 
          onClick={handleSearchForm}
          label={loading ? t('Searching...') : t('Find Parcel')}
        />
      </ActionGroup>
    </div>
  )

  return (
    <LocalizedContent>
      <PanelSection title={t('Import Parcel')}>
        <div className="flex items-center gap-2 px-3 pb-2">
          <button
            className={cn('flex-1 rounded py-1 text-xs transition-colors', mode === 'map' ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:bg-accent/50')}
            onClick={() => setMode('map')}
          >
            {t('From Map')}
          </button>
          <button
            className={cn('flex-1 rounded py-1 text-xs transition-colors', mode === 'form' ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:bg-accent/50')}
            onClick={() => setMode('form')}
          >
            {t('Ada / Parsel')}
          </button>
        </div>

        {mode === 'map' ? (
          <div className="relative">
            <LocationMap latitude={latitude} longitude={longitude} onPick={handleSearchMap} />
            {loading && (
              <div className="absolute inset-0 flex items-center justify-center bg-background/50 backdrop-blur-[1px]">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            )}
          </div>
        ) : (
          renderForm()
        )}

        {error && (
          <div className="px-3 pb-2 text-xs text-destructive">
            {error}
          </div>
        )}

        {result && (
          <div className="mx-3 mb-2 flex flex-col gap-2 rounded-md border border-border/50 bg-accent/30 p-2 text-xs">
            <div className="font-medium text-foreground">{result.label}</div>
            <div className="flex justify-between text-muted-foreground">
              <span>{t('Registered Area')}</span>
              <span className="font-medium text-foreground">
                {result.registeredAreaRaw !== undefined ? formatAreaLabel(Number(result.registeredAreaRaw), unit, 2) : '-'}
              </span>
            </div>
            <ActionGroup>
              <ActionButton onClick={handleApply} label={t('Apply to Site')} />
            </ActionGroup>
          </div>
        )}
      </PanelSection>
    </LocalizedContent>
  )
}
