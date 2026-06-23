# 流程行业基础包

流程行业基础包 ：覆盖搅拌、换热、过滤、离心、干燥、包装、储罐、管廊、阀组、粉体料仓、鼓风机和空压机撬等通用流程设备。

## Devices

- Raw material storage tank (process.raw_material_tank)
- Metering pump skid (process.metering_pump_skid)
- Mixing tank (process.mixing_tank)
- Stirred reactor (process.stirred_reactor)
- Shell and tube heat exchanger (process.heat_exchanger)
- Process filter vessel (process.filter_vessel)
- Industrial centrifuge (process.centrifuge)
- Vacuum tray dryer (process.tray_dryer)
- Product storage tank (process.product_storage_tank)
- Process packaging station (process.packaging_station)
- Process pipe corridor (process.pipe_corridor)
- Process control cabinet (process.control_cabinet)
- Bulk material silo (process.bulk_material_silo)
- Valve manifold station (process.valve_station)
- Utility blower (process.utility_blower)
- Air compressor skid (process.air_compressor_skid)

## Pack Type

Factory-capable pack: supports factory/process creation through process templates and factory architectures.

## Factory Creation

Supported whole-factory/process templates:

- Process industry basic plant (process_industry_basic_plant)

Supported factory scopes/modules:

- 基础流程生产线 (basic_process_line)
- 流程行业基础工厂 (full_process_plant)

## Factory Architectures

- 流程行业基础工厂架构

## Process Templates

- Process industry basic plant

## Validation

Run:

```bash
bun apps/editor/scripts/profile-pack-qa.ts industry.process.basic@0.1.0 --validate-only
```

