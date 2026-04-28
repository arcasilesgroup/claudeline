import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, Easing } from "remotion";

// Visual constants — same palette the Statusline composition uses, so
// both demo gifs feel cohesive.
const COLORS = {
  bg: "#0d1117",
  outer: "#08090c",
  panelBorder: "#1f2937",
  cyan: "rgb(86, 182, 194)",
  green: "rgb(0, 175, 80)",
  yellow: "rgb(230, 200, 0)",
  red: "rgb(255, 85, 85)",
  white: "rgb(220, 220, 220)",
  dim: "rgba(220, 220, 220, 0.55)",
  rule: "rgba(220, 220, 220, 0.25)",
};

const FONT =
  "'JetBrains Mono', 'Cascadia Code', 'Menlo', 'Monaco', 'Courier New', monospace";

// Stagger-fade helper. A line appears at `startFrame` and fully resolves
// over `duration` frames. We translateY a few px for a gentle "settling".
function appearAt(frame: number, startFrame: number, duration = 8) {
  const opacity = interpolate(
    frame,
    [startFrame, startFrame + duration],
    [0, 1],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.out(Easing.ease),
    },
  );
  const translate = interpolate(
    frame,
    [startFrame, startFrame + duration],
    [4, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.out(Easing.ease),
    },
  );
  return { opacity, transform: `translateY(${translate}px)` };
}

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

  // Diagnostics section
  const diagHeaderAt = next();
  const diagLine1At = next();
  const diagLine2At = next();
  const diagLine3At = next();
  const diagLine4At = next();
  const blank2At = next();

  // Configuration section
  const confHeaderAt = next();
  const confLine1At = next();
  const confLine2At = next();
  const confLine3At = next();
  const confLine4At = next();
  const blank3At = next();

  // Health section
  const healthHeaderAt = next();
  const healthLine1At = next();
  const healthLine2At = next();
  const blank4At = next();

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

        {/* Diagnostics */}
        <Line startFrame={diagHeaderAt} bold>
          {"  Diagnostics"}
        </Line>
        <Line startFrame={diagLine1At}>
          <Branch>{"├"}</Branch>
          {/* Keep in sync with package.json on each release. */}
          <span> Version: claudeline 0.3.3</span>
        </Line>
        <Line startFrame={diagLine2At}>
          <Branch>{"├"}</Branch>
          <span> Engine: Node 25.9.0</span>
        </Line>
        <Line startFrame={diagLine3At}>
          <Branch>{"├"}</Branch>
          <span> Platform: darwin-arm64</span>
        </Line>
        <Line startFrame={diagLine4At}>
          <Branch>{"└"}</Branch>
          <span>
            {" "}Cache directory:{" "}
            <span style={{ color: COLORS.dim }}>
              /var/folders/…/claudeline-501
            </span>
          </span>
        </Line>
        <Line startFrame={blank2At}>{" "}</Line>

        {/* Configuration */}
        <Line startFrame={confHeaderAt} bold>
          {"  Configuration"}
        </Line>
        <Line startFrame={confLine1At}>
          <Branch>{"├"}</Branch>
          <span> statusLine wired in ~/.claude/settings.json</span>
        </Line>
        <Line startFrame={confLine2At}>
          <Branch>{"├"}</Branch>
          <span> effortLevel in settings.json: &quot;high&quot;</span>
        </Line>
        <Line startFrame={confLine3At}>
          <Branch>{"├"}</Branch>
          <span> Cache directory exists with 0o700 permissions</span>
        </Line>
        <Line startFrame={confLine4At}>
          <Branch>{"└"}</Branch>
          <span> Stdin schema parses a synthetic test payload</span>
        </Line>
        <Line startFrame={blank3At}>{" "}</Line>

        {/* Health */}
        <Line startFrame={healthHeaderAt} bold>
          {"  Health"}
        </Line>
        <Line startFrame={healthLine1At}>
          <Branch>{"├"}</Branch>
          <span> Cache entry shape parses cleanly</span>
        </Line>
        <Line startFrame={healthLine2At}>
          <Branch>{"└"}</Branch>
          <span> State file shape parses cleanly</span>
        </Line>
        <Line startFrame={blank4At}>{" "}</Line>

        {/* Summary — bold "Summary:" label */}
        <Line startFrame={summaryAt}>
          <span style={{ fontWeight: 700 }}>{"  Summary:"}</span>
          <span> 0 errors, 0 warnings, 7 ok</span>
        </Line>
      </div>
    </AbsoluteFill>
  );
};
