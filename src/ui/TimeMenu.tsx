import { memo, useEffect, useRef, useState } from "react";
import { TIMES, TIME_LABELS, type Daylight, type TimeOfDay } from "../globe/timeOfDay";

const ICONS: Record<TimeOfDay, string> = { dawn: "◐", noon: "☀", dusk: "◑", night: "☾" };

/** "☀ Noon ▾" in the top bar: switches the light on the current view. */
export const TimeMenu = memo(function TimeMenu({ daylight, disabled }: { daylight: Daylight; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [time, setTime] = useState<TimeOfDay>(daylight.time);
  const [localTime, setLocalTime] = useState(daylight.localTime);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    // The place may have changed since last time: show the time there.
    setLocalTime(daylight.localTime);
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, daylight]);

  const pick = (t: TimeOfDay) => {
    daylight.set(t);
    setTime(t);
    setLocalTime(daylight.localTime);
  };

  return (
    <div className="time-menu" ref={root}>
      <button
        type="button"
        className={open ? "chip active" : "chip"}
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        aria-expanded={open}
        aria-label={`Time of day: ${TIME_LABELS[time]}`}
      >
        {ICONS[time]} {TIME_LABELS[time]} ▾
      </button>
      {open && (
        <div className="time-list" role="radiogroup" aria-label="Time of day">
          <div className="segmented">
            {TIMES.map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={time === t}
                className={time === t ? "active" : ""}
                onClick={() => pick(t)}
              >
                {ICONS[t]} {TIME_LABELS[t]}
              </button>
            ))}
          </div>
          <p className="fine">
            {time === "night"
              ? `Moonlit night, about ${localTime} local solar time.`
              : `Where the sun is at ${localTime} local solar time today, at the place you're viewing.`}
          </p>
        </div>
      )}
    </div>
  );
});
