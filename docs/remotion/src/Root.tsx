import { Composition } from "remotion";
import { Statusline } from "./Statusline";

// 11 seconds at 30 fps = 330 frames. Wide canvas; height bumped to 240 to
// accommodate the rounded panel + outer padding that mimics the screenshot.
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
    </>
  );
};
