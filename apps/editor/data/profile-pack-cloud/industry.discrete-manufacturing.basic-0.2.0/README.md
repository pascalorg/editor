# 离散制造基础包

????????? v0.2??? CNC?????????????????AGV ??????????????????????????????????????????????

## Devices

- CNC machining center (discrete_manufacturing.cnc_machining_center)
- Robot workcell (discrete_manufacturing.robot_workcell)
- Assembly workstation (discrete_manufacturing.assembly_workstation)
- Roller conveyor (discrete_manufacturing.roller_conveyor)
- Vision inspection station (discrete_manufacturing.vision_inspection_station)
- Packaging station (discrete_manufacturing.packaging_station)
- AGV tugger (discrete_manufacturing.agv_tugger)
- Storage rack (discrete_manufacturing.storage_rack)
- Line control cabinet (discrete_manufacturing.line_control_cabinet)
- Compressor skid (discrete_manufacturing.compressor_skid)
- Pallet kitting table (discrete_manufacturing.pallet_table)
- Chip conveyor (discrete_manufacturing.chip_conveyor)
- Safety fence (discrete_manufacturing.safety_fence)
- Utility pipe corridor (discrete_manufacturing.pipe_corridor)
- Fixture table (discrete_manufacturing.fixture_table)
- Functional test bench (discrete_manufacturing.test_bench)
- Material cart (discrete_manufacturing.material_cart)
- Palletizing workcell (discrete_manufacturing.palletizing_workcell)

## Pack Type

Factory-capable pack: supports factory/process creation through process templates and factory architectures.

## Factory Creation

Supported whole-factory/process templates:

- Discrete manufacturing flexible workshop (discrete_manufacturing_flexible_workshop)

Supported factory scopes/modules:

- Machining cell (machining_cell)
- Assembly and robot cell (assembly_cell)
- Full discrete manufacturing workshop (full_workshop)

## Factory Architectures

- Discrete manufacturing flexible workshop architecture

## Process Templates

- Discrete manufacturing flexible workshop

## Validation

Run:

```bash
bun apps/editor/scripts/profile-pack-qa.ts industry.discrete-manufacturing.basic@0.2.0 --validate-only
```
