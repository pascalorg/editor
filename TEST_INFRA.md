# E2E Test Infra: Upstream Synchronization

## Test Philosophy
- Multi-tier requirement-driven and regression testing.
- Methodology: Category-Partition + Boundary Value Analysis + Unit/Integration & Monorepo Test Runner.

## Feature Inventory & Test Coverage
| # | Feature | Source | Tier 1 (Unit) | Tier 2 (Boundary) | Tier 3 (Cross-Module) | Tier 4 (E2E) |
|---|---------|--------|:-------------:|:-----------------:|:---------------------:|:------------:|
| 1 | Zod 4.5.4 Node Schemas | Upstream & Core | 5 | 5 | ✓ | ✓ |
| 2 | Plugin Warehouse Node Schemas | Local & Core | 5 | 5 | ✓ | ✓ |
| 3 | Asset Storage & Registry | Core | 5 | 5 | ✓ | ✓ |
| 4 | Dependencies & Manifests | Root / Packages | 5 | 5 | ✓ | ✓ |
| 5 | ToolMode FSM Transitions | Editor Store | 5 | 5 | ✓ | ✓ |
| 6 | First Person & Drone Camera | Editor Controls | 5 | 5 | ✓ | ✓ |
| 7 | Move Registry Node Tool | Editor Tools | 5 | 5 | ✓ | ✓ |
| 8 | Keyboard Shortcuts | Editor Hooks | 5 | 5 | ✓ | ✓ |
| 9 | Floating Action Menu | Editor UI | 5 | 5 | ✓ | ✓ |
| 10 | Material Picker | Editor UI | 5 | 5 | ✓ | ✓ |
| 11 | High-Res Snapshot Export | Editor Overlay | 5 | 5 | ✓ | ✓ |
| 12 | Zone Deletion & Takeoff | Editor & Nodes | 5 | 5 | ✓ | ✓ |
| 13 | Monorepo Test Suite (`turbo run test`) | All Packages | 5 | 5 | ✓ | ✓ |

## Test Commands
- Single package tests:
  `bun test packages/core/src`
  `bun test packages/editor/src`
  `bun test packages/nodes/src`
  `bun test packages/viewer/src`
  `bun test packages/mcp/src`
  `bun test apps/editor/lib`
- Monorepo runner:
  `bunx turbo run test`
- Type checking:
  `bunx turbo run check-types` or `bunx tsc --noEmit`
