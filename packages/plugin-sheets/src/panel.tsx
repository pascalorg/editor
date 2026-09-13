'use client'

/**
 * Sidebar panel — the project card and the way in. The real surface is the
 * full-screen workspace (Ctrl+K → "Open sheets").
 */
import { Printer, Sparkles, SquareStack } from 'lucide-react'
import { generateDefaultSet } from './generate'
import { sceneNodes, sheets } from './model'
import { openSheets } from './overlay'
import { printSet } from './print'
import { ProjectCard, ProjectEditor, useSceneNodes } from './rail'
import { useSheets } from './store'

export default function SheetsPanel() {
  const S = useSheets()
  const nodes = useSceneNodes()
  const list = sheets(nodes)

  if (S.editingProject) {
    return (
      <div className="h-full">
        <ProjectEditor nodes={nodes} onClose={() => S.setEditingProject(false)} />
      </div>
    )
  }

  return (
    <div className="flex flex-col text-sidebar-foreground">
      <ProjectCard nodes={nodes} onEdit={() => S.setEditingProject(true)} />
      <div className="flex flex-col gap-1.5 p-3">
        <button
          type="button"
          onClick={openSheets}
          className="flex items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 font-semibold text-primary-foreground text-xs shadow-sm"
        >
          <SquareStack className="h-3.5 w-3.5" />
          Open sheets
        </button>
        <button
          type="button"
          onClick={() => {
            generateDefaultSet(sceneNodes())
            openSheets()
          }}
          className="flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs hover:bg-accent"
        >
          <Sparkles className="h-3.5 w-3.5" />
          Generate default set
        </button>
        {list.length > 0 && (
          <button
            type="button"
            onClick={() => void printSet()}
            className="flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs hover:bg-accent"
          >
            <Printer className="h-3.5 w-3.5" />
            Print / PDF ({list.length})
          </button>
        )}
      </div>
      {list.length > 0 && (
        <div className="space-y-0.5 px-3 pb-3">
          {list.map((sheet) => (
            <button
              type="button"
              key={sheet.id}
              onClick={() => {
                S.setSheet(sheet.id)
                openSheets()
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-muted-foreground text-xs hover:bg-accent"
            >
              <span className="w-11 shrink-0 font-mono text-[11px]">{sheet.number}</span>
              <span className="truncate">{sheet.title}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
