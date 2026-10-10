import CalendarNavBridge from "./calendar-nav-bridge";
import HomeTodayNeedsBridge from "./home-today-needs-bridge";
import HomeV2Bridge from "./home-v2-bridge";
import SilkOS from "./silk-os";

export default function Home() {
  return (
    <>
      <CalendarNavBridge />
      <HomeV2Bridge />
      <HomeTodayNeedsBridge />
      <SilkOS />
    </>
  );
}
