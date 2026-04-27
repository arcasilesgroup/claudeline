# Demo regeneration

This subproject renders the README demo (`docs/demo.gif` and `docs/demo.mp4`).
Only regenerate when the visible statusline changes — don't churn the
asset on every release.

```bash
cd docs/remotion
npm install                       # ~127 MB, gitignored
bunx remotion render src/index.ts statusline ../demo.mp4 \
  --width=1280 --height=180

# Re-encode to GIF with a tighter palette than Remotion's default:
ffmpeg -y -i ../demo.mp4 \
  -vf "fps=20,scale=1280:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5" \
  ../demo.gif
```

`Statusline.tsx` walks five animation phases (model+cwd, context grow,
effort+cost, rate-limit bars filling, hold). Tweak there.
