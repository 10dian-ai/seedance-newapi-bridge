---
changelogVersion: 1
plugin: "seedance-bridge"
version: "1.0.0"
locale: "zh-CN"
---
# Changelog

## [1.0.0]

### Added

- 新增面向 `doubao-seedance-2-5-260628` 的即梦/豆包 Seedance 官方任务接口桥接。
- 通过上游 New API 转发任务，同时保留任务状态、视频产物和模型映射。

### Fixed

- 提交前拒绝不支持的分辨率、非法时长、非法比例、错误媒体引用和过大的输入。
