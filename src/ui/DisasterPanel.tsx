import { memo, useState } from "react";
import type { DisasterDefinition, Params } from "../disasters/types";
import type { VolcanoMatch } from "../data/volcanoes";
import { isPhone } from "./isPhone";

export interface Vent {
  name: string;
  lat: number;
  lon: number;
  match: VolcanoMatch;
}

interface Props {
  disasters: DisasterDefinition[];
  selectedId: string;
  onSelect: (id: string) => void;
  params: Params;
  onParam: (key: string, value: number) => void;
  vent: Vent | undefined;
  picking: boolean;
  onPickVent: () => void;
  busy: boolean;
  onTrigger: () => void;
}

/**
 * Memoised: it only re-renders when its own props change, not on every
 * simulation tick that updates the rest of the app.
 */
export const DisasterPanel = memo(function DisasterPanel(props: Props) {
  const { disasters, selectedId, onSelect, params, onParam, vent, picking, onPickVent, busy, onTrigger } = props;
  const [open, setOpen] = useState(() => !isPhone());
  const selected = disasters.find((d) => d.id === selectedId) ?? disasters[0];

  if (!open) {
    return (
      <aside className="disaster-panel collapsed">
        <button type="button" className="panel-toggle" onClick={() => setOpen(true)}>
          Disasters
        </button>
      </aside>
    );
  }

  return (
    <aside className="disaster-panel" aria-label="Disasters">
      <div className="panel-head">
        <h2>Disasters</h2>
        <button type="button" className="panel-toggle" onClick={() => setOpen(false)}>
          Hide
        </button>
      </div>

      <ul className="disaster-list">
        {disasters.map((d) => (
          <li key={d.id}>
            <button
              type="button"
              className={d.id === selected.id ? "disaster active" : "disaster"}
              disabled={!d.available}
              onClick={() => onSelect(d.id)}
              title={d.description}
            >
              <span>{d.name}</span>
              {!d.available && <small>Later</small>}
            </button>
          </li>
        ))}
      </ul>

      <p className="disaster-desc">{selected.description}</p>

      <section className="vent">
        <div className="vent-row">
          <div>
            <span className="eyebrow">Vent</span>
            <strong>{vent ? vent.name : "None chosen"}</strong>
          </div>
          <button type="button" className={picking ? "chip active" : "chip"} onClick={onPickVent}>
            {picking ? "Click the map…" : "Pick on map"}
          </button>
        </div>
        {vent && <RealismNote vent={vent} />}
        {!vent && <p className="fine">Fly to a place or pick a spot on the map first.</p>}
      </section>

      <div className="params">
        {selected.params.map((p) => (
          <label key={p.key} className="param">
            <span className="param-label">
              {p.label}
              <output>
                {formatValue(params[p.key], p.step)}
                {p.unit ?? ""}
              </output>
            </span>
            <input
              type="range"
              min={p.min}
              max={p.max}
              step={p.step}
              value={params[p.key]}
              onChange={(e) => onParam(p.key, Number(e.target.value))}
            />
            {p.hint && <small>{p.hint}</small>}
          </label>
        ))}
      </div>

      <button type="button" className="trigger" disabled={!vent || busy || !selected.available} onClick={onTrigger}>
        {busy ? "Preparing…" : `Trigger ${selected.name.toLowerCase()}`}
      </button>
    </aside>
  );
});

function RealismNote({ vent }: { vent: Vent }) {
  const m = vent.match;
  if (m.kind === "real") {
    return (
      <p className="realism real">
        <b>Real volcano: {m.name}.</b> The eruption is a simplified visualisation, not a forecast.
      </p>
    );
  }
  if (m.kind === "not-volcano") {
    return (
      <p className="realism fictional">
        <b>Fictional.</b> {vent.name} is not a volcano. This is a sandbox eruption.
      </p>
    );
  }
  return (
    <p className="realism fictional">
      <b>Sandbox.</b> This spot isn't on Earthbreaker's volcano list, so treat the eruption as fictional.
    </p>
  );
}

function formatValue(value: number, step: number) {
  return step < 1 ? value.toFixed(1) : String(value);
}
