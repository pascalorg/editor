# 流程行业基础包

流程行业基础资源包，面向化工、环保、食品、制药等流程型工厂的通用几何搭建，覆盖储罐、泵组、搅拌、反应、换热、过滤、离心、干燥、包装、管廊和控制柜。

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
