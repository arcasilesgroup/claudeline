# Demo regeneration

This subproject renders the README demo gifs:

- `docs/demo-statusline.gif` — animated statusline ribbon (`Statusline.tsx`)
- `docs/demo-cli.gif` — `claudeline doctor` output reveal (`Cli.tsx`)

Only regenerate when the visible output changes — don't churn the
asset on every release.

```bash
cd docs/remotion
npm install                  # ~127 MB, gitignored

npm run render:gif:statusline   # → ../demo-statusline.gif
npm run render:gif:cli          # → ../demo-cli.gif
npm run render:gif:all          # both
```

Use `npm run studio` to live-preview either composition while
tweaking — Remotion Studio scrubs through the timeline and reflects
edits to `Statusline.tsx` / `Cli.tsx` instantly.

`Statusline.tsx` walks five animation phases (model+cwd, context
grow, effort+cost, rate-limit bars filling, hold). `Cli.tsx`
reveals the doctor output section by section, mirroring the live
`printReport` output.
