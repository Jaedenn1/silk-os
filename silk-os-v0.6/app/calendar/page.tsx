import "./calendar-page.css";
import CalendarSaveGuard from "./calendar-save-guard";
import SilkCalendar from "./silk-calendar";

export default function CalendarPage() {
  return (
    <>
      <CalendarSaveGuard />
      <SilkCalendar />
    </>
  );
}
