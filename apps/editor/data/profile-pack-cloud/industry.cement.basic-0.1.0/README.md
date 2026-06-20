# 水泥行业基础设备包

这是一个标准样板行业包，用来验证“云端下载 -> 安装 -> profile 命中 -> primitive 生成 -> 质量评分”的完整链路。

## 覆盖设备

- 煅烧段：回转窑、篦冷机、预热器塔架、旋风筒
- 粉磨段：立磨、水泥磨、辊压机
- 输送段：皮带输送机、螺旋输送机、斗式提升机
- 储存段：熟料库、水泥库
- 除尘包装段：袋收尘器、水泥包装机

## 目录结构

- `pack.json`：资源包 manifest，声明 profile 和 quality rule 文件。
- `profiles/*.json`：设备 profile。一个文件可以包含同一工段的多个设备。
- `quality-rules/cement-quality.json`：profile-aware 质量规则，用于生成后的评分和问题提示。

## 编写原则

- 行业知识放在 profile 包里，代码里只保留跨行业通用 part 能力。
- profile 尽量引用通用 parts，例如 `motor_gearbox_unit`、`bearing_block`、`hopper_body`、`pipe_manifold`、`service_platform`。
- profile 只描述“设备应该有哪些部件和语义角色”，不直接写死最终 primitive shape。
- 质量规则只约束关键角色、禁用明显错误角色和合理 shape 数，不追求 CAD 级精度。

## 回转窑样板

`cement.rotary_kiln` 是本包的重点样板 profile，包含：

- `kiln_shell`：长筒窑体
- `riding_ring`：三档轮带
- `support_roller`：轴承座/托轮语义
- `girth_gear`：大齿圈
- `kiln_drive_unit`：电机减速机传动单元
- `drive_coupling_guard`：联轴器护罩
- `kiln_tail_feed_hopper`：窑尾进料斗
- `kiln_head_outlet`：窑头出口
- `inspection_platform`：检修平台

## 验收方式

1. `validateProfilePackZip()` 能校验通过。
2. 安装资源包后，输入“回转窑”应命中 `cement.rotary_kiln`，source 为 `imported_pack`。
3. 卸载资源包后，再输入“回转窑”应退回内置/通用生成逻辑，效果和评分应明显不同。
