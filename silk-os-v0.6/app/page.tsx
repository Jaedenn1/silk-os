import CalendarNavBridge from "./calendar-nav-bridge";
import HomeTodayNeedsBridge from "./home-today-needs-bridge";
import HomeV2Bridge from "./home-v2-bridge";
import SilkOS from "./silk-os";
import TodayV2Bridge from "./today-v2-bridge";

export default function Home() {
  return (
    <>
      <CalendarNavBridge />
      <HomeV2Bridge />
      <HomeTodayNeedsBridge />
      <TodayV2Bridge />
      <SilkOS />
    </>
  );
}
