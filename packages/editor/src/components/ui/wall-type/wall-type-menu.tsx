'use client'

import {
  type Assembly,
  getWallAssemblyPreset,
  usePascalI18n,
  type WallTypeDefinition,
} from '@pascal-app/core'
import { Copy, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { cn } from '../../../lib/utils'
import {
  deleteProjectWallType,
  newWallTypeBlockedReason,
  useProjectWallTypes,
  type WallTypePlacement,
  wallTypePlacementOf,
} from '../../../lib/wall-type'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../primitives/dropdown-menu'
import { type WallTypeEditorRequest, WallTypeEditorDialog } from './wall-type-editor-dialog'

/**
 * A wall's project wall types, beside its Assembly preset: make a new type, edit the project
 * type the wall is built with, duplicate its stack (a preset's, a project type's or its own
 * custom layers) into a new type, or delete the project type. A type saved here is applied to
 * the wall (`onApply`) in the same undo step. "New" and "Duplicate" are off, and say why, once
 * the project keeps as many types as it can (`newWallTypeBlockedReason`).
 */
export function WallTypeMenu({
  assembly,
  className,
  onApply,
  placement,
}: {
  /** The wall's stack; absent for a plain single-layer wall. */
  assembly: Assembly | undefined
  className?: string
  onApply: (type: WallTypeDefinition) => void
  /** The kind of wall a new type starts as when the wall has no stack to read it from. */
  placement: WallTypePlacement
}) {
  const i18n = usePascalI18n()
  const projectTypes = useProjectWallTypes()
  const [editing, setEditing] = useState<WallTypeEditorRequest | null>(null)
  const presetId = assembly?.presetId
  const project = presetId ? projectTypes.find((type) => type.id === presetId) : undefined
  const preset = presetId ? getWallAssemblyPreset(presetId) : undefined
  const label =
    project?.label ??
    preset?.label ??
    (assembly
      ? i18n._({ id: 'editor.wallTypeMenu.custom', message: 'Custom' })
      : i18n._({ id: 'editor.buildPanel.wallTypes.plainWall', message: 'Plain wall' }))
  const blocked = newWallTypeBlockedReason(projectTypes)
  const startPlacement = assembly ? wallTypePlacementOf(assembly) : placement

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            aria-label={i18n._({
              id: 'editor.wallTypeMenu.wallTypesOf',
              message: 'Wall types: new, edit or duplicate {label}',
              values: { label },
            })}
            className={cn(
              'flex size-7 shrink-0 items-center justify-center rounded border border-border bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-foreground data-[state=open]:bg-accent',
              className,
            )}
            title={i18n._({
              id: 'editor.buildPanel.wallTypeControls.editOrDuplicateThisWallType',
              message: 'Edit or duplicate this wall type',
            })}
            type="button"
          >
            <Pencil className="size-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="truncate text-muted-foreground text-xs">
            {label}
          </DropdownMenuLabel>
          <DropdownMenuItem
            disabled={!project}
            onSelect={() =>
              project &&
              setEditing({
                mode: 'edit',
                placement: wallTypePlacementOf(project.assembly),
                id: project.id,
                label: project.label,
                assembly: project.assembly,
              })
            }
          >
            <Pencil />
            {i18n._({
              id: 'editor.buildPanel.wallTypeControls.editLayers',
              message: 'Edit layers…',
            })}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!assembly || !!blocked}
            onSelect={() =>
              assembly &&
              setEditing({ mode: 'duplicate', placement: startPlacement, label, assembly })
            }
          >
            <Copy />
            {i18n._({
              id: 'editor.buildPanel.wallTypeControls.duplicateAsANewType',
              message: 'Duplicate as a new type…',
            })}
          </DropdownMenuItem>
          {project ? (
            <DropdownMenuItem
              onSelect={() => deleteProjectWallType(project.id)}
              variant="destructive"
            >
              <Trash2 />
              {i18n._({
                id: 'editor.buildPanel.wallTypeControls.deleteFromThisProject',
                message: 'Delete from this project',
              })}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={!!blocked}
            onSelect={() => setEditing({ mode: 'new', placement: startPlacement })}
          >
            <Plus />
            {i18n._({
              id: 'editor.buildPanel.wallTypeControls.newWallType',
              message: 'New wall type…',
            })}
          </DropdownMenuItem>
          {blocked ? (
            <p className="px-2 pt-1 pb-1.5 text-[11px] text-muted-foreground leading-snug">
              {blocked}
            </p>
          ) : preset ? (
            <p className="px-2 pt-1 pb-1.5 text-[11px] text-muted-foreground leading-snug">
              {i18n._({
                id: 'editor.buildPanel.wallTypeControls.presetsStayAsCitedDuplicateOne',
                message: 'Presets stay as cited. Duplicate one to change its layers.',
              })}
            </p>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <WallTypeEditorDialog
        onClose={() => setEditing(null)}
        onSaved={onApply}
        request={editing}
      />
    </>
  )
}
