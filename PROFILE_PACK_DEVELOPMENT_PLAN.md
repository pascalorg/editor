# Profile Pack Development Plan

本文档描述行业设备 profile 包的产品化开发计划。目标是让用户按行业下载或导入 profile 包，例如水泥、化工、食品、造纸等，使几何搭建在生成行业设备时优先使用已安装的设备知识。

## 设计判断

行业包应像知识插件一样工作：

- 用户下载或导入后默认启用。
- 几何生成时系统自动匹配所有已启用 profile，不要求用户每次手动选择行业。
- 用户可以在几何搭建面板里导入包，也可以进入管理页面查看、禁用、删除。
- 行业包不直接修改源码目录，应进入受控的本地 pack store。

## 包结构

推荐 zip 包结构：

```txt
industry.cement.basic-0.1.0.zip
  pack.json
  README.md
  profiles/
    pyroprocess.json
    grinding.json
    conveying.json
    storage.json
    dust-collection-packaging.json
```

`pack.json` 示例：

```json
{
  "id": "industry.cement.basic",
  "name": "水泥行业基础设备包",
  "industry": "cement",
  "version": "0.1.0",
  "schemaVersion": "1.0",
  "appCompatibility": ">=0.8.0",
  "locale": ["zh-CN", "en-US"],
  "profiles": [
    "profiles/pyroprocess.json",
    "profiles/grinding.json"
  ]
}
```

## 阶段 1：Manifest 与本地模拟云端

目标：

- 固化 profile pack 的目录结构。
- 使用本地目录模拟云端包仓库。
- 生成第一个水泥行业包 zip。

任务：

- 增加 `pack.json` manifest 规范。
- 创建模拟云端目录：`apps/editor/data/profile-pack-cloud/`。
- 生成 `industry.cement.basic-0.1.0.zip`。
- 提供 profile 校验脚本或测试，验证 manifest 路径安全、JSON 可解析、profile family/part kind 存在。

验收：

- zip 解压后结构完整。
- 14 个水泥 profile 可通过当前 registry 校验。

## 阶段 2：Pack Loader

目标：

- 让 runtime 能识别 manifest 包，而不是盲目递归读取所有 JSON。

任务：

- 修改 `loadDeviceProfiles()`。
- `device-profile-packs/**/pack.json` 作为 manifest，不当作 profile。
- 按 manifest 的 `profiles` 列表加载 profile 文件。
- 保留旧目录兼容：没有 manifest 的目录仍可递归加载 profile JSON/YAML。
- 路径安全校验：禁止绝对路径和 `../` 逃逸。

验收：

- 包内 `pack.json` 不再产生 invalid profile warning。
- 导入包里的 profile source 为 `imported_pack`。
- loader 结果记录 pack id/version/source。

## 阶段 3：本地 Pack Store

目标：

- zip 导入后不写入源码目录，而是写入本地用户数据目录。

建议目录：

```txt
apps/editor/.local/device-profile-packs/
```

或桌面/生产环境用户目录：

```txt
%APPDATA%/pascal-editor/device-profile-packs/
```

任务：

- 增加 pack store。
- 增加 `enabled-packs.json`。
- 支持安装、启用、禁用、删除。
- merge 优先级调整为：

```txt
workspace > enabled_imported_pack > builtin > generated_candidate
```

验收：

- 用户导入 zip 后 profile 自动参与生成。
- 禁用包后 profile 不再参与匹配。
- 删除包后 loader 不报错。

## 阶段 4：几何搭建面板导入入口

目标：

- 用户在几何搭建面板内完成最常见的导入动作。

UI 建议：

```txt
几何搭建
------------------------------------------------
已启用：3 个行业包 · 128 个设备        [导入] [管理]

输入框：
生成一个 12 米回转窑
```

任务：

- 在几何搭建面板标题或输入区附近增加“导入行业包”按钮。
- 支持选择 zip。
- 导入后显示预览：
  - 包名
  - 版本
  - profile 数
  - 新增/冲突/无效项
- 默认导入后启用。
- 成功提示用户可生成哪些代表设备。

验收：

- 用户不用离开几何搭建主流程即可安装行业包。
- 导入后生成日志能显示命中的 profile 来源。

## 阶段 5：行业包管理页面

目标：

- 管理多个已安装包。

页面能力：

- 已安装包列表。
- 启用/禁用。
- 删除。
- 查看包详情。
- 查看设备 profile 列表。
- 导出 zip。

详情页展示：

```txt
水泥行业基础设备包
版本：0.1.0
状态：已启用
Profile 数：14

设备：
回转窑 / cement.rotary_kiln / tank / vessel_layout
篦冷机 / cement.grate_cooler / conveyor / linear_transport_layout
```

验收：

- 用户可以理解“已安装哪些行业知识”。
- 可以删除不用的行业包。

## 阶段 6：生成链路透明化

目标：

- 让用户知道行业包确实生效。

生成日志显示：

```txt
识别设备：回转窑
使用 profile：cement.rotary_kiln
来源：水泥行业基础设备包 v0.1.0
路线：compose_parts
评分：0.82
```

任务：

- run result 记录 pack id/version/name。
- UI 渲染 profile source。
- 当多个 profile 命中时，记录候选和最终选择原因。

验收：

- 用户能看到“为什么这次生成更准”。

## 阶段 7：云端市场

目标：

- 从云端拉取行业包索引，按需下载。

云端 index 示例：

```json
{
  "packs": [
    {
      "id": "industry.cement.basic",
      "name": "水泥行业基础设备包",
      "version": "0.1.0",
      "industry": "cement",
      "profileCount": 14,
      "downloadUrl": "https://example.com/profile-packs/industry.cement.basic-0.1.0.zip",
      "checksum": "sha256:..."
    }
  ]
}
```

验收：

- 用户可从“云端市场”下载水泥包。
- 下载后自动校验 checksum、解压、安装、启用。

## 当前本地模拟包

已生成模拟云端包：

```txt
apps/editor/data/profile-pack-cloud/industry.cement.basic-0.1.0/
apps/editor/data/profile-pack-cloud/industry.cement.basic-0.1.0.zip
```

包含 14 个 profile：

- `cement.rotary_kiln`
- `cement.grate_cooler`
- `cement.preheater_tower`
- `cement.cyclone_separator`
- `cement.vertical_raw_mill`
- `cement.cement_mill`
- `cement.roller_press`
- `cement.belt_conveyor`
- `cement.screw_conveyor`
- `cement.bucket_elevator`
- `cement.clinker_silo`
- `cement.cement_silo`
- `cement.bag_filter`
- `cement.cement_packer`

