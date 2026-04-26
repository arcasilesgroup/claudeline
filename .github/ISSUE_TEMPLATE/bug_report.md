---
name: Bug report
about: Something is wrong with claudeline
title: "[bug] "
labels: bug
assignees: ""
---

## Summary

<!-- One-sentence description of what is broken. -->

## Reproduction

Minimal stdin JSON that reproduces the issue:

```json
{
  "model": { "display_name": "Opus 4.7" },
  "cwd": "/some/path"
}
```

Command used:

```bash
echo '<the JSON above>' | claudeline render
```

## Expected output

<!-- Paste the line you expected, ANSI stripped if possible. -->

## Actual output

<!-- Paste what you got, ANSI stripped if possible. -->

## Environment

- claudeline version: <!-- `claudeline --version` -->
- OS and architecture: <!-- e.g. macOS 14.5 arm64, Ubuntu 24.04 x86_64, Windows 11 x64 -->
- Node.js version: <!-- `node --version` -->
- Bun version (if applicable): <!-- `bun --version` -->
- Terminal / shell: <!-- e.g. iTerm2 + zsh, Windows Terminal + PowerShell -->

## Additional context

<!-- Anything else that helps us reproduce or understand the issue. -->
