import { NextResponse } from 'next/server'
import {
  PIC_TO3D_DEFAULT_PARAMS,
  PIC_TO3D_PARAM_GROUPS,
  PIC_TO3D_PRESETS,
  PIC2THREE_NODES,
} from '@/lib/pic-to-3d/workflow-params'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({
    defaults: PIC_TO3D_DEFAULT_PARAMS,
    presets: PIC_TO3D_PRESETS.map(({ id, label, description, params }) => ({
      id,
      label,
      description,
      params,
    })),
    paramGroups: PIC_TO3D_PARAM_GROUPS,
    nodes: PIC2THREE_NODES,
  })
}
