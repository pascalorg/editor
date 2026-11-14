import type { AgentOperations } from '@pascal-app/core/agent-operations'
import { checkKitchenClearance, finishKitchenRun } from '../cabinet/finish-operation'
import { editDuct } from '../duct-segment/edit-operation'
import { connectPipe } from '../pipe-segment/connect-operation'
import { editPipeGrade } from '../pipe-segment/grade-operation'
import { offsetPipe } from '../pipe-segment/offset-operation'
import { resizePipe } from '../pipe-segment/resize-operation'

export { checkKitchenClearance, finishKitchenRun }
export const builtinAgentOperations = {
  pipe_connect: connectPipe,
  pipe_offset: offsetPipe,
  pipe_resize: resizePipe,
  pipe_grade: editPipeGrade,
  duct_edit: editDuct,
  kitchen_finish_run: finishKitchenRun,
  kitchen_check_clearance: checkKitchenClearance,
} satisfies AgentOperations
