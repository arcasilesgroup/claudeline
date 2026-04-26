# Security policy

## Supported versions

claudeline follows semantic versioning. Security fixes land on the latest
minor of the latest major. Older majors are not patched once a new major is
out, with a 90-day grace period announced in the release notes.

| Version | Supported          |
| ------- | ------------------ |
| 0.x     | :white_check_mark: |

## Reporting a vulnerability

**Please do not file a public GitHub issue for security problems.**

Use one of the following private channels:

1. GitHub's [private vulnerability reporting](https://github.com/arcasilesgroup/claudeline/security/advisories/new)
   (preferred — encrypted, integrated, and we get notified immediately).
2. Email `security@arcasilesgroup.com` with subject `claudeline: <short summary>`.

Please include, at minimum:

- A description of the issue and its impact
- Steps to reproduce, ideally with a minimal payload
- Affected version(s) and platform(s)
- Whether you would like to be credited in the advisory

We will acknowledge receipt within **3 working days**, share an initial
assessment within **7 days**, and aim to ship a fix within **30 days** for
high or critical issues. Lower-severity issues follow the standard release
cadence.

## Threat model

claudeline is a non-privileged CLI. It is invoked by Claude Code with a JSON
document on stdin and emits ANSI-formatted text on stdout. Its only side
effects are:

- Reading `~/.claude/settings.json` and `~/.claude/.credentials.json`
- Reading the OS keychain (macOS `security`) or libsecret (`secret-tool`)
- A single HTTPS call to `https://api.anthropic.com/api/oauth/usage`
- Writing a usage cache JSON to the OS temp directory (mode `0600`)
- Spawning `git`, `defaults` (macOS only), and `ps` for status detection

The threat surfaces we care about, in order:

1. **Token exposure.** The OAuth access token must never be logged, written
   to the cache, sent to any host other than `api.anthropic.com`, or echoed
   to stdout/stderr. The renderer never has the token in scope.
2. **Argument and command injection.** Every external command is invoked
   with `child_process.spawnSync` using a fixed argv array — no shell
   interpolation. Arguments come from constants or are `String(ppid)`.
3. **Untrusted JSON.** Anything coming from stdin or the API is parsed
   through Zod and ignored on failure (`Claude` is printed as a safe
   fallback).
4. **Denial-of-service.** API calls have a 5 s `AbortController` timeout.
   The cache caps refreshes to once per minute. The git, ps, and defaults
   subprocesses are bounded by the OS.
5. **Cache file permissions.** The cache is created with `0o700` on the
   directory and `0o600` on the file. It only contains rate-limit
   metadata returned by the API — no tokens.

## Out of scope

- Bugs in Claude Code itself or in third-party MCP servers.
- Vulnerabilities only reachable by an attacker who already has shell access
  to the user's machine as the same UID.
- Issues caused by users overriding their own `settings.json` with hostile
  content (the file is owned and authored by the user).

## Hardening tips for users

- Do not check your `~/.claude/.credentials.json` into source control.
- Avoid piping output of `claudeline render` through evaluators (`eval`,
  `bash -c …`); the output is intentionally ANSI-decorated.
- Run on a current Node.js (≥ 20 LTS) and current Bun release.
