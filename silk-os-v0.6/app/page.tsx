import CalendarNavBridge from "./calendar-nav-bridge";
import HomeTodayNeedsBridge from "./home-today-needs-bridge";
import HomeV2Bridge from "./home-v2-bridge";
import InspirationScreensaver from "./inspiration-screensaver";
import MomentumBridge from "./momentum-bridge";
import ProactiveSilk from "./proactive-silk";
import SilkOS from "./silk-os";
import TodayV2Bridge from "./today-v2-bridge";

export default function Home() {
  return (
    <>
      <CalendarNavBridge />
      <HomeV2Bridge />
      <HomeTodayNeedsBridge />
      <TodayV2Bridge />
      <MomentumBridge />
      <ProactiveSilk />
      <InspirationScreensaver />
      <SilkOS />
    </>
  );
}
