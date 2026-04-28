import React from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import {
  appearAt as appearAtBase,
  BASE_COLORS,
  colorForPct,
  EXTRA_COLORS,
  FONT,
} from "./_helpers.js";

// Statusline composition needs the badge palette (blue/orange/magenta)
// plus a slightly more transparent `dim` than the doctor demo.
const COLORS = {
  ...BASE_COLORS,
  ...EXTRA_COLORS,
  dim: "rgba(220, 220, 220, 0.4)",
};

// The ribbon is a stable display element; a 12-frame settle reads more
// natural than the 8-frame default the CLI demo uses for its line-by-line
// reveal. Wrap the shared helper to lock in our duration.
function appearAt(frame: number, startFrame: number, duration = 12) {
  return appearAtBase(frame, startFrame, duration);
}

const Separator: React.FC<{ visible?: boolean }> = ({ visible = true }) => (
  <span
    style={{
      color: COLORS.dim,
      margin: "0 14px",
      opacity: visible ? 1 : 0,
      transition: "opacity 200ms",
    }}
  >
    │
  </span>
);

interface BarProps {
  pct: number;
  width?: number;
  filledColor: string;
}

const Bar: React.FC<BarProps> = ({ pct, width = 10, filledColor }) => {
  const filledCount = Math.round((pct / 100) * width);
  const cells = [];
  for (let i = 0; i < width; i++) {
    cells.push(
      <span
        key={i}
        style={{
          color: i < filledCount ? filledColor : COLORS.dim,
          letterSpacing: "0.5px",
        }}
      >
        {i < filledCount ? "●" : "○"}
      </span>,
    );
  }
  return <span>{cells}</span>;
};

export const Statusline: React.FC = () => {
  const frame = useCurrentFrame();

  // Phase timing (frames at 30 fps):
  //   0-30    Phase 1: model + cwd + branch
  //   30-90   Phase 2: context % grows 0 -> 47% (color shifts green -> orange)
  //   90-150  Phase 3: effort, thinking, cost
  //   150-220 Phase 4: rate-limit bars fill — current 0->95%, weekly 0->75%
  //   220-330 Phase 5: hold final state (110 frames ≈ 3.7 s)

  // Phase 1 — staggered model / context-placeholder / dir.
  const modelStyle = appearAt(frame, 0);
  const dirStyle = appearAt(frame, 14);

  // Phase 2 — context %.
  const contextAppear = appearAt(frame, 28);
  const contextPctRaw = interpolate(frame, [30, 90], [0, 47], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.ease),
  });
  const contextPct = Math.round(contextPctRaw);
  const contextColor = colorForPct(contextPct);

  // Phase 3 — cost, effort, thinking.
  const costAppear = appearAt(frame, 90);
  const costAmount = interpolate(frame, [90, 140], [0, 0.84], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.ease),
  });
  // 3 decimals while < $1, 2 decimals otherwise — matches src/segments.ts:costSegment.
  const costDisplay = costAmount < 1 ? costAmount.toFixed(3) : costAmount.toFixed(2);

  const effortAppear = appearAt(frame, 110);
  const thinkingOpacity = interpolate(
    frame,
    [122, 134],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.ease) },
  );
  // Subtle pulse on the brain glyph once it's visible — small scale wobble.
  const brainPulse = interpolate(
    frame,
    [122, 140, 158, 176, 194, 212, 230, 248, 266, 284, 302, 320],
    [1, 1.12, 1, 1.12, 1, 1.12, 1, 1.12, 1, 1.12, 1, 1.12],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  // Phase 4 — rate limits. Bars walk through every threshold so the user
  // visibly sees the green -> orange -> yellow -> red color transitions.
  const rateLabelAppear = appearAt(frame, 150);
  const fivePct = interpolate(frame, [150, 220], [0, 95], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.quad),
  });
  const sevenPct = interpolate(frame, [165, 220], [0, 75], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.quad),
  });
  const projectionAppear = appearAt(frame, 200);

  // Tasteful soft cursor blink at end-of-line during phase 1.
  const cursorVisible = Math.floor(frame / 15) % 2 === 0 && frame < 28;

  return (
    <AbsoluteFill
      style={{
        backgroundColor: COLORS.outer,
        fontFamily: FONT,
        fontSize: 28,
        lineHeight: 1.45,
        color: COLORS.white,
        padding: 30,
        boxSizing: "border-box",
        fontFeatureSettings: '"liga" 0',
      }}
    >
      {/* Inner rounded panel — mimics the docs/screenshot-active-dark.png look */}
      <div
        style={{
          width: "100%",
          height: "100%",
          backgroundColor: COLORS.bg,
          borderRadius: 16,
          padding: "26px 36px",
          boxSizing: "border-box",
          boxShadow: `0 0 0 1px ${COLORS.panelBorder}`,
        }}
      >
        {/* Line 1: model | context | dir | cost | effort + brain */}
        <div style={{ display: "flex", alignItems: "center", whiteSpace: "pre" }}>
          <span style={{ color: COLORS.blue, ...modelStyle, display: "inline-block" }}>
            Opus 4.7 (1M context)
          </span>

          {/* Context segment — appears mid-phase-1, then animates value */}
          <span
            style={{
              ...contextAppear,
              display: "inline-flex",
              alignItems: "center",
            }}
          >
            <Separator />
            <span style={{ marginRight: 8 }}>✍️</span>
            <span style={{ color: contextColor, fontVariantNumeric: "tabular-nums" }}>
              {contextPct}%
            </span>
          </span>

          {/* Directory + git branch */}
          <span
            style={{
              ...dirStyle,
              display: "inline-flex",
              alignItems: "center",
            }}
          >
            <Separator />
            <span style={{ color: COLORS.cyan }}>claudeline</span>
            <span style={{ color: COLORS.green, marginLeft: 10 }}>
              (main<span style={{ color: COLORS.red }}>*</span>)
            </span>
          </span>

          {/* Cost segment */}
          <span
            style={{
              ...costAppear,
              display: "inline-flex",
              alignItems: "center",
            }}
          >
            <Separator />
            <span style={{ marginRight: 8 }}>💸</span>
            <span style={{ color: COLORS.yellow, fontVariantNumeric: "tabular-nums" }}>
              ${costDisplay}
            </span>
          </span>

          {/* Effort + thinking */}
          <span
            style={{
              ...effortAppear,
              display: "inline-flex",
              alignItems: "center",
            }}
          >
            <Separator />
            <span style={{ color: COLORS.magenta }}>◉ max</span>
          </span>

          <span
            style={{
              opacity: thinkingOpacity,
              display: "inline-flex",
              alignItems: "center",
              marginLeft: 14,
              transform: `scale(${brainPulse})`,
              transformOrigin: "center",
            }}
          >
            <span>🧠</span>
          </span>

          {/* Cursor blink at end-of-line during phase 1 */}
          {cursorVisible && (
            <span
              style={{
                display: "inline-block",
                width: 14,
                height: 28,
                marginLeft: 6,
                backgroundColor: COLORS.white,
                opacity: 0.55,
              }}
            />
          )}
        </div>

        {/* Line 2: current rate-limit */}
        <div
          style={{
            marginTop: 14,
            display: "flex",
            alignItems: "center",
            ...rateLabelAppear,
            whiteSpace: "pre",
          }}
        >
          <span style={{ color: COLORS.white, width: "8ch", display: "inline-block" }}>
            current
          </span>
          <span style={{ marginLeft: 6 }}>
            <Bar pct={fivePct} filledColor={colorForPct(fivePct)} />
          </span>
          <span
            style={{
              marginLeft: 14,
              color: colorForPct(fivePct),
              fontVariantNumeric: "tabular-nums",
              minWidth: "4ch",
              display: "inline-block",
            }}
          >
            {`${Math.round(fivePct)}`.padStart(3, " ")}%
          </span>
          <span
            style={{
              ...projectionAppear,
              marginLeft: 14,
              display: "inline-flex",
              alignItems: "center",
            }}
          >
            <span style={{ color: COLORS.dim }}>~</span>
            <span style={{ color: COLORS.white, marginLeft: 2 }}>24m</span>
          </span>
          <span style={{ marginLeft: 14, color: COLORS.dim }}>⟳</span>
          <span style={{ marginLeft: 8, color: COLORS.white }}>17:30</span>
        </div>

        {/* Line 3: weekly rate-limit */}
        <div
          style={{
            marginTop: 4,
            display: "flex",
            alignItems: "center",
            ...rateLabelAppear,
            whiteSpace: "pre",
          }}
        >
          <span style={{ color: COLORS.white, width: "8ch", display: "inline-block" }}>
            weekly
          </span>
          <span style={{ marginLeft: 6 }}>
            <Bar pct={sevenPct} filledColor={colorForPct(sevenPct)} />
          </span>
          <span
            style={{
              marginLeft: 14,
              color: colorForPct(sevenPct),
              fontVariantNumeric: "tabular-nums",
              minWidth: "4ch",
              display: "inline-block",
            }}
          >
            {`${Math.round(sevenPct)}`.padStart(3, " ")}%
          </span>
          <span style={{ marginLeft: 14, color: COLORS.dim }}>⟳</span>
          <span style={{ marginLeft: 8, color: COLORS.white }}>3 may, 09:00</span>
        </div>
      </div>
    </AbsoluteFill>
  );
};
