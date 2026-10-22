import type { ToolOption } from '@pascal-app/core'
import { useEditor } from '@pascal-app/editor'

export const ductTerminalToolOptions: ToolOption[] = [
  {
    id: 'terminalType',
    label: 'Terminal',
    choices: [
      { value: 'supply-register', label: 'Supply register' },
      { value: 'diffuser', label: 'Diffuser' },
      { value: 'return-grille', label: 'Return grille' },
    ],
    value: () =>
      String(useEditor.getState().toolDefaults['duct-terminal']?.terminalType ?? 'supply-register'),
    subscribe: (callback) => useEditor.subscribe(callback),
    set: (value) => {
      if (!['supply-register', 'diffuser', 'return-grille'].includes(value)) return
      useEditor.getState().setToolDefaults('duct-terminal', {
        ...useEditor.getState().toolDefaults['duct-terminal'],
        terminalType: value,
      })
    },
  },
]
