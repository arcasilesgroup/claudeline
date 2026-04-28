import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { appearAt, BASE_COLORS, FONT } from "./_helpers.js";

// CLI demo wants its own `dim` and `rule` shades — the doctor reveal is
// busier than the statusline ribbon, so a slightly higher-contrast `dim`
// reads better against the panel background.
const COLORS = {
  ...BASE_COLORS,
  dim: "rgba(220, 220, 220, 0.55)",
  rule: "rgba(220, 220, 220, 0.25)",
};

interface LineProps {
  startFrame: number;
  children: React.ReactNode;
  bold?: boolean;
}
const Line: React.FC<LineProps> = ({
  startFrame,
  children,
  bold = false,
}) => {
  const frame = useCurrentFrame();
  const style = appearAt(frame, startFrame);
  return (
    <div
      style={{
        ...style,
        color: COLORS.white,
        fontWeight: bold ? 700 : 400,
        whiteSpace: "pre",
        lineHeight: 1.55,
      }}
    >
      {children}
    </div>
  );
};

const Branch: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span style={{ color: COLORS.dim }}>{"  "}{children}</span>
);

// A Diagnostics / Configuration / Health block: bold header, then N
// branch leaves on the same gap, then a blank for vertical breathing
// room. The glyph for each leaf is `├` until the last, which gets `└`.
// `text` is React.ReactNode so callers can drop in nested spans for the
// colored cache-directory path.
interface SectionProps {
  title: string;
  startFrame: number;
  gap?: number;
  lines: React.ReactNode[];
}
const Section: React.FC<SectionProps> = ({
  title,
  startFrame,
  gap = 6,
  lines,
}) => {
  const blankAt = startFrame + (lines.length + 1) * gap;
  return (
    <>
      <Line startFrame={startFrame} bold>
        {`  ${title}`}
      </Line>
      {lines.map((text, i) => {
        const last = i === lines.length - 1;
        return (
          <Line key={i} startFrame={startFrame + (i + 1) * gap}>
            <Branch>{last ? "└" : "├"}</Branch>
            <span> {text}</span>
          </Line>
        );
      })}
      <Line startFrame={blankAt}>{" "}</Line>
    </>
  );
};

// Rules: a 72-char ─ rule, exactly like the live `printReport` output.
const Rule: React.FC<{ startFrame: number }> = ({ startFrame }) => {
  const frame = useCurrentFrame();
  const style = appearAt(frame, startFrame);
  return (
    <div
      style={{
        ...style,
        color: COLORS.rule,
        whiteSpace: "pre",
        lineHeight: 1.55,
      }}
    >
      {"─".repeat(72)}
    </div>
  );
};

export const Cli: React.FC = () => {
  // Stagger plan (30 fps). One line every 6 frames after the prompt.
  // Summary lands around frame 152 (~5 s); composition runs 410 frames
  // total (see Root.tsx), so ~8.6 s of hold give the viewer time to read.
  let f = 0;
  const next = (gap = 6) => {
    f += gap;
    return f;
  };

  // Prompt + command typing — show prompt at 0, command "types in" at 8.
  const promptAt = 0;
  const cmdAt = 8;

  const ruleAt = next(36); // longer pause before the report begins
  const blank1At = next();

  // Each section reserves (lines.length + 1) gaps of 6 frames: one for
  // the header + one per leaf. The +1 trailing gap is the blank that
  // `<Section>` renders for vertical breathing room.
  const diagHeaderAt = next();
  f += 4 * 6 + 6; // 4 leaves + blank
  const confHeaderAt = next();
  f += 4 * 6 + 6;
  const healthHeaderAt = next();
  f += 2 * 6 + 6;

  // Summary
  const summaryAt = next();

  return (
    <AbsoluteFill
      style={{
        backgroundColor: COLORS.outer,
        padding: 28,
        fontFamily: FONT,
        fontSize: 20,
      }}
    >
      <div
        style={{
          backgroundColor: COLORS.bg,
          border: `1px solid ${COLORS.panelBorder}`,
          borderRadius: 10,
          padding: "20px 28px",
          height: "100%",
          boxSizing: "border-box",
          overflow: "hidden",
        }}
      >
        {/* Prompt + typed command */}
        <Line startFrame={promptAt}>
          <span style={{ color: COLORS.green, fontWeight: 700 }}>$ </span>
          <span style={{ opacity: 0 }}>claudeline doctor</span>
        </Line>
        <div style={{ marginTop: -28 }}>
          <Line startFrame={cmdAt}>
            <span style={{ opacity: 0 }}>$ </span>
            <span>claudeline doctor</span>
          </Line>
        </div>

        {/* Top rule */}
        <div style={{ height: 16 }} />
        <Rule startFrame={ruleAt} />
        <Line startFrame={blank1At}>{" "}</Line>

        <Section
          title="Diagnostics"
          startFrame={diagHeaderAt}
          lines={[
            // Version label kept in sync with package.json each release.
            "Version: claudeline 0.3.3",
            "Engine: Node 25.9.0",
            "Platform: darwin-arm64",
            <>
              Cache directory:{" "}
              <span style={{ color: COLORS.dim }}>
                /var/folders/…/claudeline-501
              </span>
            </>,
          ]}
        />
        <Section
          title="Configuration"
          startFrame={confHeaderAt}
          lines={[
            "statusLine wired in ~/.claude/settings.json",
            "effortLevel in settings.json: \"high\"",
            "Cache directory exists with 0o700 permissions",
            "Stdin schema parses a synthetic test payload",
          ]}
        />
        <Section
          title="Health"
          startFrame={healthHeaderAt}
          lines={[
            "Cache entry shape parses cleanly",
            "State file shape parses cleanly",
          ]}
        />

        {/* Summary — bold "Summary:" label */}
        <Line startFrame={summaryAt}>
          <span style={{ fontWeight: 700 }}>{"  Summary:"}</span>
          <span> 0 errors, 0 warnings, 6 ok</span>
        </Line>
      </div>
    </AbsoluteFill>
  );
};
