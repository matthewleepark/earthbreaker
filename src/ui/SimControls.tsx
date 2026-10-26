import type { SimState } from "../disasters/controller";

interface Props {
  state: SimState;
  orbiting: boolean;
  onPause: () => void;
  onResume: () => void;
  onReset: () => void;
  onReplay: () => void;
  onSpeed: (speed: number) => void;
  onToggleEffects: () => void;
  onToggleOrbit: () => void;
}

const SPEEDS = [1, 2, 4];

/** Bottom bar for a running disaster: transport, speed, timeline and before/after. */
export function SimControls({ state, orbiting, onPause, onResume, onReset, onReplay, onSpeed, onToggleEffects, onToggleOrbit }: Props) {
  const { status, elapsed, duration, phase, speed, effectsVisible } = state;
  const progress = duration ? Math.min(1, elapsed / duration) : 0;
  const preparing = status === "preparing";

  return (
    <div className="sim-bar" role="group" aria-label="Simulation controls">
      <div className="sim-row">
        {status === "running" && (
          <button type="button" className="chip" onClick={onPause}>Pause</button>
        )}
        {status === "paused" && (
          <button type="button" className="chip active" onClick={onResume}>Resume</button>
        )}
        {(status === "finished" || preparing) && (
          <button type="button" className="chip" onClick={onReplay} disabled={preparing}>Replay</button>
        )}
        <button type="button" className="chip" onClick={onReset}>Reset</button>

        <div className="segmented" role="radiogroup" aria-label="Playback speed">
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={speed === s}
              className={speed === s ? "active" : ""}
              onClick={() => onSpeed(s)}
            >
              {s}×
            </button>
          ))}
        </div>

        <button type="button" className={effectsVisible ? "chip" : "chip active"} onClick={onToggleEffects} disabled={preparing}>
          {effectsVisible ? "Before" : "After"}
        </button>
        <button type="button" className={orbiting ? "chip active" : "chip"} onClick={onToggleOrbit} disabled={preparing}>
          Orbit
        </button>
      </div>

      <div className="timeline">
        <span className="phase">{preparing ? "Preparing…" : phase}</span>
        <div className="track" aria-hidden="true">
          <div className="fill" style={{ width: `${progress * 100}%` }} />
        </div>
        <span className="time">
          {clock(elapsed)} / {clock(duration)}
        </span>
      </div>
      <p className="fine">
        Time-lapse visualisation, not a scientific forecast.{!effectsVisible && " Showing the landscape before the eruption."}
      </p>
    </div>
  );
}

function clock(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
