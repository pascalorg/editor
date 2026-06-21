# 炼油厂基础行业包

面向一句话创建炼油厂的基础行业包，覆盖原油罐区、常减压、转化/加氢、硫回收、火炬、公用工程和产品罐区。

## Devices

- Crude storage tank (refinery.crude_storage_tank)
- Intermediate storage tank (refinery.intermediate_storage_tank)
- Product storage tank (refinery.product_storage_tank)
- Crude desalter (refinery.desalter)
- Atmospheric distillation unit (refinery.atmospheric_distillation_unit)
- Vacuum distillation unit (refinery.vacuum_distillation_unit)
- Fluid catalytic cracking unit (refinery.fluid_catalytic_cracking_unit)
- Hydrotreating unit (refinery.hydrotreating_unit)
- Catalytic reformer unit (refinery.catalytic_reformer_unit)
- Sulfur recovery unit (refinery.sulfur_recovery_unit)
- Flare system (refinery.flare_system)
- Main pipe rack (refinery.pipe_rack)
- Utility boiler (refinery.utility_boiler)
- Control room and MCC (refinery.control_room)

## Pack Type

Factory-capable pack: supports factory/process creation through process templates and factory architectures.

## Factory Creation

Supported whole-factory/process templates:

- Basic oil refinery complex (refinery_basic_complex)

Supported factory scopes/modules:

- 基础炼油厂 (basic_refinery)

## Factory Architectures

- 炼油厂基础架构

## Process Templates

- Basic oil refinery complex

## Validation

Run:

```bash
bun apps/editor/scripts/profile-pack-qa.ts industry.refinery.basic@0.1.0 --validate-only
```
