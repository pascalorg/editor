# Cement Basic Equipment Pack

水泥行业基础资源包，覆盖水泥厂整厂、熟料烧成线，以及常见水泥生产设备。

## Pack Type

Factory-capable pack: supports whole-factory/process creation through process templates and factory architectures.

## Factory Creation

支持整厂 / 工序:

- Full cement plant (`cement_plant_full`)
- Clinker production line (`cement_clinker_line`)

支持范围:

- Clinker burning line (`pyro_line`)
- Complete clinker production system (`clinker_system`)
- Full cement plant (`cement_plant`)
- Clinker production line (`clinker_line`)

## Devices

- Limestone crusher (`cement.limestone_crusher`)
- Stacker reclaimer (`cement.stack_reclaimer`)
- Vertical raw mill (`cement.vertical_raw_mill`)
- Raw meal homogenization silo (`cement.raw_meal_homogenization_silo`)
- Coal mill (`cement.coal_mill`)
- Preheater tower (`cement.preheater_tower`)
- Rotary kiln (`cement.rotary_kiln`)
- Kiln burner (`cement.kiln_burner`)
- Kiln hood (`cement.kiln_hood`)
- Grate cooler (`cement.grate_cooler`)
- Clinker crusher (`cement.clinker_crusher`)
- Belt conveyor (`cement.belt_conveyor`)
- Clinker silo (`cement.clinker_silo`)
- ESP dust collector (`cement.esp_dust_collector`)
- Process stack (`cement.process_stack`)
- Cement mill (`cement.cement_mill`)
- Cement silo (`cement.cement_silo`)
- Cement packer (`cement.cement_packer`)
- WHR boiler (`cement.whr_boiler`)

## Validation

```bash
bun apps/editor/scripts/profile-pack-qa.ts industry.cement.basic@0.1.0 --validate-only
```
