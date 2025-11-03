/**
 * ECS Core - Entity-Component-System Foundation
 *
 * Lightweight ECS runtime derived from the node tree.
 * Entities are identified by node IDs, components are stored in typed maps.
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Entity identifier (same as node ID for traceability)
 */
export type EntityId = string

/**
 * Component type identifier
 */
export type ComponentType = string

/**
 * Base interface for all components
 */
export interface Component {
  readonly __brand?: never
}

/**
 * Component store for a specific component type
 */
export class ComponentStore<T extends Component> {
  private readonly data = new Map<EntityId, T>()

  set(entity: EntityId, component: T): void {
    this.data.set(entity, component)
  }

  get(entity: EntityId): T | undefined {
    return this.data.get(entity)
  }

  has(entity: EntityId): boolean {
    return this.data.has(entity)
  }

  delete(entity: EntityId): boolean {
    return this.data.delete(entity)
  }

  clear(): void {
    this.data.clear()
  }

  entries(): IterableIterator<[EntityId, T]> {
    return this.data.entries()
  }

  keys(): IterableIterator<EntityId> {
    return this.data.keys()
  }

  values(): IterableIterator<T> {
    return this.data.values()
  }

  get size(): number {
    return this.data.size
  }
}

/**
 * The World holds all entities and their components
 */
export class World {
  private readonly components = new Map<ComponentType, ComponentStore<any>>()
  private readonly entities = new Set<EntityId>()

  // Metadata
  readonly gridSizeMeters: number // Size of one grid unit in meters (default 0.5)

  constructor(options?: { gridSizeMeters?: number }) {
    this.gridSizeMeters = options?.gridSizeMeters ?? 0.5
  }

  // ========================================================================
  // ENTITY MANAGEMENT
  // ========================================================================

  /**
   * Register an entity (typically done during node-to-world conversion)
   */
  addEntity(id: EntityId): void {
    this.entities.add(id)
  }

  /**
   * Remove an entity and all its components
   */
  removeEntity(id: EntityId): void {
    this.entities.delete(id)
    for (const store of this.components.values()) {
      store.delete(id)
    }
  }

  /**
   * Check if entity exists
   */
  hasEntity(id: EntityId): boolean {
    return this.entities.has(id)
  }

  /**
   * Get all entity IDs
   */
  getAllEntities(): EntityId[] {
    return Array.from(this.entities)
  }

  // ========================================================================
  // COMPONENT MANAGEMENT
  // ========================================================================

  /**
   * Get or create a component store for a given type
   */
  private getOrCreateStore<T extends Component>(type: ComponentType): ComponentStore<T> {
    let store = this.components.get(type)
    if (!store) {
      store = new ComponentStore<T>()
      this.components.set(type, store)
    }
    return store as ComponentStore<T>
  }

  /**
   * Add a component to an entity
   */
  setComponent<T extends Component>(entity: EntityId, type: ComponentType, component: T): void {
    const store = this.getOrCreateStore<T>(type)
    store.set(entity, component)
  }

  /**
   * Get a component from an entity
   */
  getComponent<T extends Component>(entity: EntityId, type: ComponentType): T | undefined {
    const store = this.components.get(type)
    return store?.get(entity)
  }

  /**
   * Check if entity has a component
   */
  hasComponent(entity: EntityId, type: ComponentType): boolean {
    const store = this.components.get(type)
    return store?.has(entity) ?? false
  }

  /**
   * Remove a component from an entity
   */
  removeComponent(entity: EntityId, type: ComponentType): boolean {
    const store = this.components.get(type)
    return store?.delete(entity) ?? false
  }

  /**
   * Get all entities with a specific component
   */
  getEntitiesWithComponent<T extends Component>(type: ComponentType): Array<[EntityId, T]> {
    const store = this.components.get(type)
    if (!store) return []
    return Array.from(store.entries())
  }

  /**
   * Get the component store for a specific type (for system access)
   */
  getComponentStore<T extends Component>(type: ComponentType): ComponentStore<T> | undefined {
    return this.components.get(type) as ComponentStore<T> | undefined
  }

  // ========================================================================
  // QUERIES
  // ========================================================================

  /**
   * Query entities that have ALL specified components
   */
  query(...componentTypes: ComponentType[]): EntityId[] {
    if (componentTypes.length === 0) {
      return Array.from(this.entities)
    }

    // Start with entities that have the first component
    const firstStore = this.components.get(componentTypes[0])
    if (!firstStore) return []

    const candidates = Array.from(firstStore.keys())

    // Filter by remaining components
    return candidates.filter((entity) =>
      componentTypes.every((type) => this.hasComponent(entity, type)),
    )
  }

  /**
   * Query entities with components, returning tuples of [EntityId, ...Components]
   */
  queryWith<T1 extends Component>(type1: ComponentType): Array<[EntityId, T1]>
  queryWith<T1 extends Component, T2 extends Component>(
    type1: ComponentType,
    type2: ComponentType,
  ): Array<[EntityId, T1, T2]>
  queryWith<T1 extends Component, T2 extends Component, T3 extends Component>(
    type1: ComponentType,
    type2: ComponentType,
    type3: ComponentType,
  ): Array<[EntityId, T1, T2, T3]>
  queryWith(...componentTypes: ComponentType[]): Array<[EntityId, ...Component[]]> {
    const entities = this.query(...componentTypes)
    return entities
      .map((entity) => {
        const components = componentTypes.map((type) => this.getComponent(entity, type))
        if (components.some((c) => c === undefined)) return null
        return [entity, ...components] as [EntityId, ...Component[]]
      })
      .filter((result): result is [EntityId, ...Component[]] => result !== null)
  }

  // ========================================================================
  // UTILITIES
  // ========================================================================

  /**
   * Clear all data
   */
  clear(): void {
    this.entities.clear()
    this.components.clear()
  }

  /**
   * Get statistics about the world
   */
  getStats(): {
    entityCount: number
    componentTypeCount: number
    totalComponents: number
  } {
    let totalComponents = 0
    for (const store of this.components.values()) {
      totalComponents += store.size
    }

    return {
      entityCount: this.entities.size,
      componentTypeCount: this.components.size,
      totalComponents,
    }
  }
}

// ============================================================================
// HELPER UTILITIES
// ============================================================================

/**
 * Convert meters to grid units
 */
export function metersToGrid(
  meters: number | [number, number],
  gridSizeMeters: number,
): number | [number, number] {
  if (Array.isArray(meters)) {
    return [meters[0] / gridSizeMeters, meters[1] / gridSizeMeters]
  }
  return meters / gridSizeMeters
}

/**
 * Convert grid units to meters
 */
export function gridToMeters(
  grid: number | [number, number],
  gridSizeMeters: number,
): number | [number, number] {
  if (Array.isArray(grid)) {
    return [grid[0] * gridSizeMeters, grid[1] * gridSizeMeters]
  }
  return grid * gridSizeMeters
}
