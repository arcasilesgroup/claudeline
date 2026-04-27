import { Composition } from "remotion";
import { Cli } from "./Cli";
import { Statusline } from "./Statusline";

// Two compositions — both rendered to GIFs for the README.
//   `statusline` (1280×240, 11 s):   the live ribbon at the bottom of
//                                    Claude Code, animated through every
//                                    threshold colour transition.
//   `cli`        (1280×680, 13.7 s): the new `claudeline doctor` output,
//                                    revealed section by section.
export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="statusline"
        component={Statusline}
        durationInFrames={330}
        fps={30}
        width={1280}
        height={240}
      />
      <Composition
        id="cli"
        component={Cli}
        durationInFrames={410}
        fps={30}
        width={1280}
        height={680}
      />
    </>
  );
};
