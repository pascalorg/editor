import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import Editor from '@/components/editor'
import { ActionMenu } from '@/components/editor/action-menu/index'
import { ImageUI, RoofUI, ScanUI } from '@pascal/core/components/nodes'
import { SiteUI } from '@/components/nodes/site/site-ui'
import { StairUI } from '@/components/nodes/stair/stair-ui'

gsap.registerPlugin(useGSAP)

export default function Home() {
  return (
    <div className="flex h-screen w-full max-w-screen">
      <div className="relative h-full w-full">
        <Editor />
        <ActionMenu />
        <SiteUI />
        <RoofUI />
        <StairUI />
        <ImageUI />
        <ScanUI />
      </div>
    </div>
  )
}
