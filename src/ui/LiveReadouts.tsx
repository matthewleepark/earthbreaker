// Readouts that change many times a second (camera position, tile loading,
// frame rate). Each one subscribes to Cesium itself and re-renders only its
// own few elements at a capped rate, so the rest of the app stays still while
// the camera moves or shakes.
import { useEffect, useState } from "react";
import { Math as CesiumMath } from "cesium";
import type { Globe } from "../globe/createGlobe";
import { POWER_LABELS, type PowerMode } from "../globe/performance";
import { formatLatLon, formatMetres } from "./format";

/** Calls `read` at most every `ms`, and only re-renders when the text changes. */
function usePolled<T>(read: () => T, ms: number, deps: unknown[]): T {
  const [value, setValue] = useState(read);
  useEffect(() => {
    const id = window.setInterval(() => {
      const next = read();
      // Keeping the previous object when nothing changed lets React skip the render.
      setValue((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    }, ms);
    return () => window.clearInterval(id);
  }, deps);
  return value;
}

export function CameraRow({ globe }: { globe: Globe }) {
  const text = usePolled(
    () => {
      const c = globe.viewer.camera.positionCartographic;
      return {
        value: `${formatMetres(c.height)} up`,
        note: formatLatLon(CesiumMath.toDegrees(c.latitude), CesiumMath.toDegrees(c.longitude)),
      };
    },
    250,
    [globe],
  );
  return (
    <div className="row">
      <dt>Camera</dt>
      <dd>
        {text.value}
        <small>{text.note}</small>
      </dd>
    </div>
  );
}

const POWER_HINTS: Record<PowerMode, string> = {
  smooth: "Up to 60 fps. Best on desktops and gaming laptops.",
  balanced: "30 fps, but full speed while you move the camera: about half the work, so laptops run cooler and quieter.",
  saver: "30 fps and lighter effects, for slow computers or battery.",
};

/** Frame rate, quality level and the power mode buttons. */
export function PerformanceRow({ globe }: { globe: Globe }) {
  const perf = globe.perf;
  // Re-render straight away when the mode changes, not on the next poll.
  const [, bump] = useState(0);
  useEffect(() => perf.subscribe(() => bump((n) => n + 1)), [perf]);
  const text = usePolled(
    () => (perf.fps === undefined ? `${perf.levelName} quality` : `${Math.round(perf.fps)} fps · ${perf.levelName} quality`),
    1000,
    [perf],
  );
  return (
    <div className="row">
      <dt>Rendering</dt>
      <dd>
        {text}
        <div className="power" role="radiogroup" aria-label="Power mode">
          {(Object.keys(POWER_LABELS) as PowerMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={perf.mode === mode}
              className={perf.mode === mode ? "active" : ""}
              onClick={() => perf.setMode(mode)}
              title={POWER_HINTS[mode]}
            >
              {POWER_LABELS[mode]}
            </button>
          ))}
        </div>
        <small>
          {POWER_HINTS[perf.mode]}
          {perf.automatic && " Picked automatically for this computer."}
        </small>
      </dd>
    </div>
  );
}

/** Shows while flying or while map tiles (terrain or Google's 3D tiles) are still loading. */
export function LoadingPill({ globe, flying }: { globe: Globe; flying: boolean }) {
  const [pending, setPending] = useState(0);
  useEffect(() => {
    let globePending = 0;
    let tilesPending = 0;
    let timer = 0;
    // Batch the many progress events into one update every 300 ms.
    const schedule = () => {
      if (!timer) timer = window.setTimeout(() => {
        timer = 0;
        setPending(globePending + tilesPending);
      }, 300);
    };
    const removers = [
      globe.viewer.scene.globe.tileLoadProgressEvent.addEventListener((n: number) => {
        globePending = globe.viewer.scene.globe.show ? n : 0;
        schedule();
      }),
    ];
    if (globe.photoreal) {
      removers.push(
        globe.photoreal.loadProgress.addEventListener((pendingRequests: number, processing: number) => {
          tilesPending = globe.photoreal?.show ? pendingRequests + processing : 0;
          schedule();
        }),
      );
    }
    return () => {
      removers.forEach((r) => r());
      window.clearTimeout(timer);
    };
  }, [globe]);

  if (!flying && pending === 0) return null;
  return (
    <div className="loading-pill" role="status">
      {flying ? "Flying…" : `Loading map tiles · ${pending}`}
    </div>
  );
}
