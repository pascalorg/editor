import type { AgentOperations } from '@pascal-app/core/agent-operations'
import { checkKitchenClearance, finishKitchenRun } from '../cabinet/finish-operation'

export { checkKitchenClearance, finishKitchenRun }
export const builtinAgentOperations = {
  kitchen_finish_run: finishKitchenRun,
  kitchen_check_clearance: checkKitchenClearance,
} satisfies AgentOperations
