import { LayoutGroup } from 'motion/react'
import { AgentActivitySection } from '../../panels/agent/agent-activity-section'
import { AgentPromptBox } from '../../panels/agent/agent-prompt-box'
import { CommentsSection } from '../../panels/comments/comments-section'

export function ActivityPanel() {
  return (
    <LayoutGroup>
      <div className="flex h-full flex-col overflow-y-auto">
        <CommentsSection />
        <AgentPromptBox />
        <AgentActivitySection />
      </div>
    </LayoutGroup>
  )
}
