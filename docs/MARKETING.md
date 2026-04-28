# Marketing & distribution playbook

Internal doc — not published to npm. Tracking ground for community-list
submissions, launch posts, and one-line pitches we re-use across channels.

## Headline pitches (re-use these verbatim)

**Tweet/HN sub-title length (≤140 chars):**

> Cross-platform statusline for Claude Code. Cost ribbon, rate-limit projection, latency tail badges. One-line install, no Node required.

**Description-style (≤280 chars):**

> claudeline shows what your Claude Code session costs, when your 5-hour limit hits, and how slow the API feels — right in the bottom statusline. Bun-bundled, runs on macOS / Linux / Windows. `curl | bash` install or `brew install`.

**Long-form (paragraph for community lists):**

> claudeline is a statusline for Claude Code that shows model, context-window utilisation, server-reported cost, the 5-hour and weekly rate-limit bars (with a burn-rate projection), an effort/thinking indicator, and a slow-API badge sourced from p50/p99 latency. It's a single Bun-compiled binary, runs on macOS / Linux / Windows, and ships via npm + Homebrew + a one-line installer. `claudeline doctor` covers the eight common config pitfalls; `claudeline summary` keeps a local cost-history opt-in (no telemetry).

## Submission targets (in priority order)

Status legend: ☐ pending / ☑ submitted / ✗ declined

### P0 — high-leverage, cheap

- ☐ **Anthropic community projects page** — last seen at <https://docs.claude.com/en/docs/community/integrations> or similar. Confirm canonical URL before submitting; the page tends to move with each docs revamp. Submit via PR if it's a markdown file in a public repo, otherwise via support@anthropic.com.
- ☐ **`hesreallyhim/awesome-claude-code`** — the canonical "awesome" list for Claude Code tooling. PR adding a one-line entry under "CLI tools" or "Statusline".
- ☐ **`philipparndt/awesome-claude-code-tools`** — secondary awesome list. Same PR template.

### P1 — high-impact, more effort

- ☐ **Hacker News (Show HN)** — best timing: Mon-Tue, ~13:00 UTC. Title: "Show HN: claudeline — a statusline for Claude Code with cost + rate-limit bars". Body: short demo gif link, "what it solves", "what it doesn't try to solve", repo link. Don't link to Twitter.
- ☐ **Reddit `/r/ClaudeAI`** — "I built a Claude Code statusline that shows your live session cost". Lead with the demo gif. Mods are friendly to OSS launches; check sub rules.
- ☐ **Reddit `/r/programming`** — only if HN floats well. Reframe around the cross-platform Bun bundling story rather than the Claude-Code aspect.

### P2 — niche, repeatable

- ☐ **Bluesky / Mastodon dev-tool circles** — short demo gif + repo link.
- ☐ **claude-code-templates / claude-code-plugins** — if those exist as community-curated registries.
- ☐ **Personal blog post** about the doctor section/tree UX (~clig.dev style decisions). Engineers love reading these; serves as content for HN later.

## Pre-launch checklist

Before any P1 submission, verify:

- [ ] One-line install works on a fresh macOS arm64
- [ ] One-line install works on a fresh Linux x64 (cloud VM is fine)
- [ ] `npm i -g @arcasilesgroup/claudeline` works on Windows (PowerShell shell)
- [ ] `claudeline doctor` shows zero warnings on all three
- [ ] `demo-cli.gif` and `demo-statusline.gif` in README render at full resolution on github.com (not blurred)
- [ ] Latest release page lists all 5 binaries + sha256 sidecars
- [ ] CHANGELOG `## [Unreleased]` has been moved to a versioned section
- [ ] Twitter/X account exists with a pinned post linking back (if we want social follow-through)

## Post templates

### Hacker News (Show HN)

> **Title:** Show HN: claudeline — a statusline for Claude Code with cost + rate-limit bars
>
> **Body:**
>
> I built claudeline because Claude Code's default statusline doesn't tell you what your session is actually costing or when you'll hit your 5-hour rate cap.
>
> What it shows: model, context %, server-reported cost (`💸 $0.42`), 5-hour and weekly bars with a `~38m` burn-rate projection, optional `--fast` and 1M-context badges, and a `🐢 Xms` slow-API badge from p50/p99 OAuth-API latency.
>
> Cross-platform: macOS / Linux / Windows. Single Bun-compiled binary, no Node runtime required (npm install also works if you prefer that).
>
> One-line install:
> ```
> curl -fsSL https://raw.githubusercontent.com/arcasilesgroup/claudeline/main/scripts/install.sh | bash
> ```
>
> Repo: https://github.com/arcasilesgroup/claudeline
>
> Demo gifs at the top of the README. Happy to answer questions about the architecture (Bun's `--compile` cross-platform story, dependency injection in TS for testability, etc.) or the design choices (why pass/warn/fail icons instead of emoji, why bubble warnings out into their own block, why opt-in cost tracking vs always-on).

### Reddit /r/ClaudeAI

> **Title:** I built a Claude Code statusline that shows your live session cost (and projects when you'll hit your 5-hour cap)
>
> **Body:**
>
> Couple of things bugged me about the default statusline:
>
> - I never knew what a session was costing until after the fact
> - I'd hit the 5-hour rate limit without warning
> - When the OAuth API was slow, my prompts felt slow but I had no signal *why*
>
> claudeline pulls all of that into the bottom-of-prompt ribbon. Demo gif, install instructions, and the design rationale all in the README.
>
> https://github.com/arcasilesgroup/claudeline
>
> Single Bun-compiled binary, npm install, Homebrew tap, or a `curl | bash` one-liner — pick your poison. macOS, Linux, Windows.
>
> Happy to take feedback. The next thing on the list is a notification when you cross 80% on the 5-hour cap, and an opt-in `claudeline summary` for "this week I burned $X across N sessions" history.

### awesome-claude-code PR description

> Adds claudeline (https://github.com/arcasilesgroup/claudeline), a cross-platform Claude Code statusline showing model, context %, server-reported cost, 5-hour / weekly rate limits with burn-rate projection, latency p50/p99 badge, and effort / thinking indicators. Ships via npm + Homebrew + one-line installer. Opt-in local session history via `claudeline summary`.

## Notes on framing

- Lead with the **cost ribbon** in social copy. People care about money before they care about ergonomics.
- Differentiate from kamranahmedse/claude-statusline where useful: Windows support, server-side cost truth, projection. Don't trash the bash original — it's a perfectly fine product, just not what claudeline is targeting.
- Avoid claiming "official" or "endorsed" anywhere. claudeline is a third-party tool; Anthropic could ship a competing native feature any time, and we want to be friendly partners.
- Privacy framing on `summary`: emphasise opt-in, local-only, easy to disable. People will ask.

## Tracking after launch

After each submission, capture in a one-line note here:

- Date
- Channel
- Title / link
- Result (stars delta, downloads delta, comments-of-note)

Used to inform the next round of submissions and the eventual telemetry-driven backlog (P1.6 in the PM doc).
