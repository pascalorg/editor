import * as Y from 'yjs'

export interface MultiplayerUndoManagerOptions {
  doc: Y.Doc
  trackedTypes?: Y.AbstractType<any>[]
  captureTimeout?: number
}

/**
 * Scoped Collaborative Undo/Redo Engine.
 * Configures Y.UndoManager to track ONLY mutations with origin 'local' (or null),
 * completely isolating the local client's undo stack from concurrent remote edits.
 */
export class MultiplayerUndoManager {
  private undoManager: Y.UndoManager

  constructor({
    doc,
    trackedTypes,
    captureTimeout = 500,
  }: MultiplayerUndoManagerOptions) {
    const defaultTypes: Y.AbstractType<any>[] = [
      doc.getMap('nodes'),
      doc.getArray('rootNodeIds'),
      doc.getMap('materials'),
      doc.getMap('collections'),
      doc.getArray('installedPlugins'),
    ]

    this.undoManager = new Y.UndoManager(trackedTypes || defaultTypes, {
      trackedOrigins: new Set(['local', null]),
      captureTimeout,
    })
  }

  public undo(): void {
    if (this.canUndo()) {
      this.undoManager.undo()
    }
  }

  public redo(): void {
    if (this.canRedo()) {
      this.undoManager.redo()
    }
  }

  public canUndo(): boolean {
    return this.undoManager.undoStack.length > 0
  }

  public canRedo(): boolean {
    return this.undoManager.redoStack.length > 0
  }

  public stopCapturing(): void {
    this.undoManager.stopCapturing()
  }

  public clear(): void {
    this.undoManager.clear()
  }

  public destroy(): void {
    this.undoManager.destroy()
  }

  public getRawUndoManager(): Y.UndoManager {
    return this.undoManager
  }
}
