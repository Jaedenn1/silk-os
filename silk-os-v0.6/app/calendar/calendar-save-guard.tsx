"use client";

import { useEffect } from "react";

export default function CalendarSaveGuard() {
  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const button = target?.closest("button") as HTMLButtonElement | null;
      if (!button || button.disabled || button.textContent?.trim() !== "Save event") return;

      const form = button.closest("form") as HTMLFormElement | null;
      if (!form) return;

      event.preventDefault();
      form.requestSubmit();
    };

    document.addEventListener("click", handleClick, true);
    return () => document.removeEventListener("click", handleClick, true);
  }, []);

  return null;
}
