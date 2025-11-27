import Editor from '@/components/editor'
import { ActionMenu } from '@/components/editor/action-menu/index'
import { StairUI } from '@/components/nodes/stair/stair-ui'

export default function Home() {
  return (
    <div className="flex h-screen w-full max-w-screen">
      <div className="relative h-full w-full">
        <Editor />
        <ActionMenu />
        <StairUI />
      </div>
    </div>
  )
}
