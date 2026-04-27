import { Composition } from "remotion";
import { Statusline } from "./Statusline";

// 8 seconds at 30 fps = 240 frames. Wide-and-short canvas matches the
// terminal statusline shape.
export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="statusline"
        component={Statusline}
        durationInFrames={240}
        fps={30}
        width={1280}
        height={180}
      />
    </>
  );
};
