'use client'

import { useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo } from 'react'
import useCollaborationPresence from '../../store/use-collaboration-presence'

export function CollaborationPresenceOverlay() {
  const localActorId = useCollaborationPresence((state) => state.localActorId)
  const participantRecord = useCollaborationPresence((state) => state.participants)
  const conflict = useCollaborationPresence((state) => state.conflict)
  const participants = useMemo(
    () => Object.values(participantRecord).filter(({ actorId }) => actorId !== localActorId),
    [localActorId, participantRecord],
  )

  useEffect(() => {
    const selectedIds = [...new Set(participants.flatMap((participant) => participant.selectedIds))]
    useViewer.getState().setExternalSelectedIds(selectedIds)
    return () => useViewer.getState().setExternalSelectedIds([])
  }, [participants])

  if (participants.length === 0 && !conflict) return null

  return (
    <div
      className="pointer-events-none absolute inset-0 z-50 overflow-hidden"
      data-collaboration-presence
    >
      {participants.map((participant) =>
        participant.cursor ? (
          <div
            className="absolute flex items-start"
            key={participant.actorId}
            style={{
              left: `${participant.cursor.x * 100}%`,
              top: `${participant.cursor.y * 100}%`,
              transform: 'translate(-2px, -2px)',
            }}
          >
            <svg
              aria-hidden="true"
              className="h-5 w-5 drop-shadow-sm"
              fill="none"
              viewBox="0 0 20 20"
            >
              <path
                d="M3 2.5 16 10l-6 .9-3.2 5.2L3 2.5Z"
                fill={participant.color}
                stroke="white"
                strokeLinejoin="round"
                strokeWidth="1.5"
              />
            </svg>
            <span
              className="-ml-1 mt-4 max-w-40 truncate rounded-full px-2 py-0.5 font-medium text-[11px] text-white shadow-sm"
              style={{ backgroundColor: participant.color }}
            >
              {participant.name}
            </span>
          </div>
        ) : null,
      )}
      <div className="absolute top-3 right-3 flex -space-x-2">
        {participants.slice(0, 5).map((participant) => (
          <div
            className="grid h-7 w-7 place-items-center rounded-full border-2 border-background font-semibold text-[10px] text-white shadow-sm"
            key={participant.actorId}
            style={{ backgroundColor: participant.color }}
            title={participant.name}
          >
            {participant.name.slice(0, 2).toUpperCase()}
          </div>
        ))}
      </div>
      {conflict ? (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 rounded-md border border-amber-500/40 bg-background/95 px-3 py-2 text-foreground text-xs shadow-lg">
          {conflict}
        </div>
      ) : null}
    </div>
  )
}
