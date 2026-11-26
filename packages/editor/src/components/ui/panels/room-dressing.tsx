'use client'

import {
  type AnyNode, type AnyNodeId, findLevelAncestorId, MATERIAL_CATALOG, type PascalI18n,
  runAsSingleSceneHistoryStep, usePascalI18n, useScene, WallTrimProfile,
} from '@pascal-app/core'
import { type DressedRoom, type DressLayer, type DressLayerKind, dressRoom } from '@pascal-app/core/agent-operations'
import { isAgentRefusal } from '@pascal-app/core/agent-tools'
import { useId, useRef, useState } from 'react'

const layerLabels = (i18n: PascalI18n) => ({
  skirting: i18n._({ id: 'editor.dressing.skirting', message: 'Skirting' }),
  chairRail: i18n._({ id: 'editor.dressing.chairRail', message: 'Chair rail' }),
  crown: i18n._({ id: 'editor.dressing.crown', message: 'Crown' }),
  wainscot: i18n._({ id: 'editor.dressing.wainscot', message: 'Wainscot' }),
  tiles: i18n._({ id: 'editor.dressing.tiles', message: 'Tiles' }),
  splashback: i18n._({ id: 'editor.dressing.splashback', message: 'Splashback' }),
  accent: i18n._({ id: 'editor.dressing.accent', message: 'Feature wall' }),
})
const fieldLabels = (i18n: PascalI18n) => ({
  from: i18n._({ id: 'editor.dressing.from', message: 'From' }),
  to: i18n._({ id: 'editor.dressing.to', message: 'To' }),
  height: i18n._({ id: 'editor.dressing.height', message: 'Height' }),
  depth: i18n._({ id: 'editor.dressing.depth', message: 'Depth' }),
  offsetY: i18n._({ id: 'editor.dressing.offset', message: 'Offset' }),
  margin: i18n._({ id: 'editor.dressing.margin', message: 'Margin' }),
})
const control = 'w-full rounded-md border border-border bg-transparent px-2 py-1 text-sm'
const button = 'rounded-full border border-border px-3 py-1 text-xs disabled:opacity-40'
const trim = (kind: DressLayerKind) => ['skirting', 'chairRail', 'crown'].includes(kind)
const selected = (select: HTMLSelectElement) => Array.from(select.selectedOptions, (option) => option.value)
type Row = { id: number; layer: DressLayer }
type Report = { rooms: DressedRoom[]; skipped?: { why: string }[]; note?: string; written: boolean }

/** The mounted room workflow calls the same atomic planner as dress_room. */
export function RoomDressing({ zoneId }: { zoneId: string }) {
  const i18n = usePascalI18n()
  const kinds = layerLabels(i18n)
  const nodes = useScene((state) => state.nodes)
  const readOnly = useScene((state) => state.readOnly)
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<Row[]>([])
  const [report, setReport] = useState<Report>()
  const [error, setError] = useState<string>()
  const nextId = useRef(0)
  const regionId = useId()
  const zone = nodes[zoneId as AnyNodeId]
  if (zone?.type !== 'zone') return null
  const levelId = findLevelAncestorId(zone.id, nodes)
  const walls = (zone.boundaryWallIds ?? []).flatMap((id) => nodes[id] ? [nodes[id]!] : [])
  const targets = Object.values(nodes).filter((node) =>
    (node.type === 'item' || node.type === 'cabinet') && findLevelAncestorId(node.id, nodes) === levelId)
  const change = (next: Row[]) => {
    setRows(next)
    setReport(undefined)
    setError(undefined)
  }
  const execute = (dryRun: boolean) => {
    try {
      const scene = useScene.getState()
      if (!dryRun && scene.readOnly) return
      const outcome = dressRoom(scene.nodes, { zoneIds: [zoneId], layers: rows.map((row) => row.layer), dryRun },
        { activeLevelId: levelId, materials: scene.materials })
      if (!dryRun && outcome.changes?.update?.length) {
        const updates = outcome.changes.update.map(({ id, data }) => ({ id: id as AnyNodeId, data }))
        runAsSingleSceneHistoryStep(useScene, () => useScene.getState().applyNodeChanges({ update: updates }))
      }
      setReport(outcome.result as Report)
      setError(undefined)
    } catch (caught) {
      setReport(undefined)
      setError(isAgentRefusal(caught) ? `${caught.code}: ${caught.message}` :
        i18n._({ id: 'editor.dressing.failed', message: 'The room could not be dressed. No changes were applied.' }))
    }
  }
  const move = (index: number, delta: number) => {
    const next = [...rows]
    ;[next[index], next[index + delta]] = [next[index + delta]!, next[index]!]
    change(next)
  }
  return (
    <section className="mt-3 border-t border-border pt-3" data-room-dressing={zoneId}>
      <button aria-controls={regionId} aria-expanded={open} className={button} onClick={() => setOpen(!open)} type="button">
        {i18n._({ id: 'editor.dressing.title', message: 'Dress room' })}
      </button>
      {open && <div className="mt-3 flex flex-col gap-3" id={regionId}>
        <p className="text-xs text-muted-foreground">{i18n._({ id: 'editor.dressing.replaces',
          message: 'Apply replaces this room’s previous dressing regions, not hand paint. An empty stack removes those regions; trims stay. Lengths are in metres.' })}</p>
        {rows.map((row, index) => <fieldset className="space-y-2 rounded-lg border border-border p-2" data-dress-layer={index} key={row.id}>
          <legend className="px-1 text-xs">{i18n._({ id: 'editor.dressing.layer', message: 'Layer {number}', values: { number: index + 1 } })}</legend>
          <LayerFields layer={row.layer} onChange={(layer) => change(rows.map((entry) => entry.id === row.id ? { ...entry, layer } : entry))}
            targets={targets} walls={walls} />
          <div className="flex flex-wrap gap-1">
            <button className={button} disabled={index === 0} onClick={() => move(index, -1)} type="button">{i18n._({ id: 'editor.dressing.up', message: 'Move up' })}</button>
            <button className={button} disabled={index === rows.length - 1} onClick={() => move(index, 1)} type="button">{i18n._({ id: 'editor.dressing.down', message: 'Move down' })}</button>
            <button className={button} onClick={() => change(rows.filter((entry) => entry.id !== row.id))} type="button">{i18n._({ id: 'editor.dressing.remove', message: 'Remove layer' })}</button>
          </div>
        </fieldset>)}
        <div className="flex flex-wrap gap-2">
          <button className={button} disabled={rows.length >= 8} onClick={() => change([...rows, { id: nextId.current++, layer: { kind: 'wainscot', finish: 'library:preset-white' } }])} type="button">
            {i18n._({ id: 'editor.dressing.add', message: 'Add layer' })}
          </button>
          <button className={button} data-dress-preview onClick={() => execute(true)} type="button">{i18n._({ id: 'editor.dressing.preview', message: 'Preview' })}</button>
          <button className={button} data-dress-apply disabled={readOnly} onClick={() => execute(false)} type="button">{i18n._({ id: 'editor.dressing.apply', message: 'Apply' })}</button>
        </div>
        {error && <p className="text-xs text-red-500" role="alert">{error}</p>}
        {report && <div className="space-y-1 text-xs" role="status">
          <p>{report.written ? i18n._({ id: 'editor.dressing.applied', message: 'Room dressing applied.' }) :
            i18n._({ id: 'editor.dressing.previewOnly', message: 'Preview only — nothing changed.' })}</p>
          {report.rooms.flatMap((room) => room.faces.map((face) => <div key={`${room.zoneId}/${face.wallId}/${face.face}`}>
            <strong>{nodes[face.wallId as AnyNodeId]?.name || face.wallId} · {face.face.toUpperCase()}</strong>
            <ul className="list-inside list-disc">
              {face.regions.map((region) => <li key={region.id}>{region.finish} · {i18n._({ id: 'editor.dressing.regionExtent',
                message: 'Along {start}–{end}; height {bottom}–{top}', values: {
                  start: region.u0 ?? 0, end: region.u1 ?? i18n._({ id: 'editor.dressing.wallEnd', message: 'wall end' }),
                  bottom: region.v0 ?? 0, top: region.v1 ?? i18n._({ id: 'editor.dressing.ceiling', message: 'ceiling' }),
                } })}</li>)}
              {Object.entries(face.trims).map(([kind, config]) => <li key={kind}>{kinds[kind as DressLayerKind]} · {config.height} × {config.depth} m · {config.profile}</li>)}
            </ul>
            <span>{i18n._({ id: 'editor.dressing.regionCount', message: '{count} of 8 face regions', values: { count: face.count } })}</span>
          </div>))}
          {report.skipped?.map((skip, index) => <p key={`${index}/${skip.why}`}>{skip.why}</p>)}
          {report.note && <p>{report.note}</p>}
        </div>}
      </div>}
    </section>
  )
}

function LayerFields({ layer, onChange, targets, walls }: {
  layer: DressLayer; onChange: (layer: DressLayer) => void; targets: AnyNode[]; walls: AnyNode[]
}) {
  const i18n = usePascalI18n()
  const kinds = layerLabels(i18n)
  const fields = fieldLabels(i18n)
  const materialList = useId()
  const where = (patch: Partial<NonNullable<DressLayer['where']>>) =>
    onChange({ ...layer, where: { ...layer.where, ...patch } })
  const number = (field: keyof typeof fields) => {
    const value = field === 'margin' ? layer.where?.margin : layer[field]
    return <label className="block text-xs" key={field}>
      {fields[field]}
      <input className={control} min={0}
        onChange={(event) => {
          const value = event.currentTarget.value === '' ? undefined : event.currentTarget.valueAsNumber
          if (field === 'margin') where({ margin: value })
          else onChange({ ...layer, [field]: value })
        }} step="any" type="number" value={typeof value === 'number' ? value : ''} />
    </label>
  }
  const placement = layer.where?.around !== undefined ? 'around' : layer.where?.alongRun !== undefined ? 'run' : 'walls'
  return <>
    <label className="block text-xs">{i18n._({ id: 'editor.dressing.kind', message: 'Layer type' })}
      <select className={control} onChange={(event) => onChange({ kind: event.target.value as DressLayerKind,
        finish: layer.finish, where: layer.where?.walls ? { walls: layer.where.walls } : undefined })} value={layer.kind}>
        {Object.entries(kinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
    </label>
    <label className="block text-xs">{i18n._({ id: 'editor.dressing.finish', message: 'Finish' })}
      <input className={control} list={materialList} onChange={(event) => onChange({ ...layer, finish: event.target.value || undefined })}
        placeholder={i18n._({ id: 'editor.dressing.finishPlaceholder', message: 'library:… / scene:… / #rrggbb' })} value={layer.finish ?? ''} />
      <datalist id={materialList}>{MATERIAL_CATALOG.map((material) => <option key={material.id} value={`library:${material.id}`}>{material.label}</option>)}</datalist>
    </label>
    <label className="block text-xs">{i18n._({ id: 'editor.dressing.walls', message: 'Walls' })}
      <select className={control} multiple onChange={(event) => {
        const ids = selected(event.currentTarget)
        where({ walls: ids.length ? ids : undefined })
      }} value={layer.where?.walls ?? []}>
        {walls.map((wall) => <option key={wall.id} value={wall.id}>{wall.name || wall.id}</option>)}
      </select>
      <span className="text-muted-foreground">{i18n._({ id: 'editor.dressing.allWalls', message: 'No selection means all room walls; feature walls require a selection.' })}</span>
    </label>
    {trim(layer.kind) ? <>
      <div className="grid grid-cols-2 gap-2">{number('height')}{number('depth')}{layer.kind === 'chairRail' && number('offsetY')}</div>
      <label className="block text-xs">{i18n._({ id: 'editor.dressing.profile', message: 'Profile' })}
        <select className={control} onChange={(event) => onChange({ ...layer, profile: event.target.value ? event.target.value as DressLayer['profile'] : undefined })} value={layer.profile ?? ''}>
          <option value="">{i18n._({ id: 'editor.dressing.existing', message: 'Existing or default' })}</option>
          {WallTrimProfile.options.map((profile) => <option key={profile} value={profile}>{profile}</option>)}
        </select>
      </label>
    </> : <>
      <div className="grid grid-cols-2 gap-2">{layer.kind === 'splashback' && number('from')}{layer.to !== 'full' && number('to')}</div>
      <label className="flex items-center gap-2 text-xs">
        <input checked={layer.to === 'full'} onChange={(event) => onChange({ ...layer, to: event.target.checked ? 'full' : undefined })} type="checkbox" />
        {i18n._({ id: 'editor.dressing.full', message: 'Full height' })}
      </label>
      <label className="block text-xs">{i18n._({ id: 'editor.dressing.placement', message: 'Placement' })}
        <select className={control} onChange={(event) => onChange({ ...layer, where: { walls: layer.where?.walls,
          ...(event.target.value === 'around' ? { around: [] } : event.target.value === 'run' ? { alongRun: '' } : {}) } })} value={placement}>
          <option value="walls">{i18n._({ id: 'editor.dressing.selectedWalls', message: 'Selected walls' })}</option>
          <option value="around">{i18n._({ id: 'editor.dressing.around', message: 'Around fixtures' })}</option>
          <option value="run">{i18n._({ id: 'editor.dressing.alongRun', message: 'Along cabinet run' })}</option>
        </select>
      </label>
      {placement === 'around' && <>
        <label className="block text-xs">{i18n._({ id: 'editor.dressing.around', message: 'Around fixtures' })}
          <select className={control} multiple onChange={(event) => where({ around: selected(event.currentTarget) })} value={layer.where?.around ?? []}>
            {targets.filter((node) => node.type === 'item').map((node) => <option key={node.id} value={node.id}>{node.name || node.id}</option>)}
          </select>
        </label>
        {number('margin')}
      </>}
      {placement === 'run' && <label className="block text-xs">{i18n._({ id: 'editor.dressing.alongRun', message: 'Along cabinet run' })}
        <select className={control} onChange={(event) => where({ alongRun: event.target.value })} value={layer.where?.alongRun ?? ''}>
          <option value="">{i18n._({ id: 'editor.dressing.chooseRun', message: 'Choose a base run' })}</option>
          {targets.filter((node) => node.type === 'cabinet' && node.runTier === 'base').map((node) => <option key={node.id} value={node.id}>{node.name || node.id}</option>)}
        </select>
      </label>}
    </>}
  </>
}
