import Editor from '@/components/editor'
import { BuildingMenu } from '@/components/editor/building-menu'
import { ControlModeMenu } from '@/components/editor/control-mode-menu'
import { StairUI } from '@/components/nodes/stair/stair-ui'

export default function Home() {
  return (
    <div className="flex h-screen w-full max-w-screen">
      <div className="relative h-full w-full">
        <Editor />

        {/* {contextMenuState.isOpen &&
        contextMenuState.type === 'wall' &&
        selectedElements.length > 0 && (
          <div
            className="fixed z-50 min-w-32 rounded-md border bg-popover p-1 text-popover-foreground shadow-lg"
            style={{
              top: `${contextMenuState.position.y}px`,
              left: `${contextMenuState.position.x}px`,
            }}
          >
            {contextMenuState.wallSegment && (
              <div
                className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
                onClick={() => {
                  handleDeleteSelectedElements()
                  setContextMenuState((prev) => ({ ...prev, isOpen: false }))
                }}
              >
                <Trash2 className="h-4 w-4" />
                Delete Selected Elements
              </div>
            )}
          </div>
        )} */}

        <ControlModeMenu />
        <BuildingMenu />
        <StairUI />
      </div>
    </div>
  )
}
