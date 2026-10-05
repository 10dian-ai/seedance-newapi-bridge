---
changelogVersion: 1
plugin: "seedance-bridge"
version: "1.0.0"
locale: "en"
translations:
  zh-CN: CHANGELOG.zh-CN.md
---
# Changelog

## [1.0.0]

### Added

- Add an official Doubao/Seedance task API bridge for the `doubao-seedance-2-5-260628` model.
- Forward native task requests through an upstream New API gateway while preserving task status, video artifacts, and model mapping.

### Fixed

- Reject unsupported resolutions, invalid durations, invalid ratios, malformed media references, and unsafe oversized input before submission.
