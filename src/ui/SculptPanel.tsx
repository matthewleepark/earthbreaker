import { memo, useState } from "react";
import type { SculptEdit, SculptKind } from "../globe/sculptShapes";
import { isPhone } from "./isPhone";
import { PanelTabs, type LeftTab } from "./PanelTabs";

export interface SculptTool {
  kind: SculptKind;
  radiusM: number;
  heightM: number;
}

const TOOLS: Array<{ kind: SculptKind; label: string; hint: string; height: [number, number, number]; radius: [number, number, number] }> = [
  { kind: "peak", label: "Spawn peak", hint: "A new mountain with ridges down its sides", height: [500, 5000, 2500], radius: [1500, 12000, 5000] },
  { kind: "raise", label: "Raise land", hint: "A smooth swell of higher ground", height: [100, 1500, 400], radius: [1000, 10000, 4000] },
  { kind: "lower", label: "Lower land", hint: "A hollow or basin", height: [100, 1500, 400], radius: [1000, 10000, 4000] },
];

export function defaultTool(kind: SculptKind = "peak"): SculptTool {
  const t = TOOLS.find((x) => x.kind === kind)!;
  return { kind, heightM: t.height[2], radiusM: t.radius[2] };
}

interface Props {
  onTab: (tab: LeftTab) => void;
  tool: SculptTool;
  onTool: (tool: SculptTool) => void;
  placing: boolean;
  onPlace: () => void;
  edits: readonly SculptEdit[];
  onUndo: () => void;
  onClear: () => void;
  /** Why sculpting is unavailable right now, if it is. */
  blocked?: string;
  photoreal: boolean;
}

/** Sculpt mode: spawn a peak, raise or lower land where you click. Local and visual only. */
export const SculptPanel = memo(function SculptPanel(props: Props) {
  const { onTab, tool, onTool, placing, onPlace, edits, onUndo, onClear, blocked, photoreal } = props;
  const [open, setOpen] = useState(() => !isPhone());
  const spec = TOOLS.find((t) => t.kind === tool.kind)!;

  if (!open) {
    return (
      <aside className="disaster-panel collapsed">
        <button type="button" className="panel-toggle" onClick={() => setOpen(true)}>
          Sculpt
        </button>
      </aside>
    );
  }

  return (
    <aside className="disaster-panel" aria-label="Sculpt">
      <div className="panel-head">
        <PanelTabs active="sculpt" onTab={onTab} />
        <button type="button" className="panel-toggle" onClick={() => setOpen(false)}>
          Hide
        </button>
      </div>

      <div className="disaster-list sculpt-tools" role="radiogroup" aria-label="Sculpt tool">
        {TOOLS.map((t) => (
          <button
            key={t.kind}
            type="button"
            role="radio"
            aria-checked={tool.kind === t.kind}
            className={tool.kind === t.kind ? "disaster active" : "disaster"}
            onClick={() => onTool(defaultTool(t.kind))}
          >
            <span>{t.label}</span>
          </button>
        ))}
      </div>
      <p className="disaster-desc">{spec.hint}. Changes are only on your screen; the real map data isn't touched.</p>

      <div className="params">
        <label className="param">
          <span className="param-label">
            {tool.kind === "lower" ? "Depth" : "Height"}
            <output>{tool.heightM.toLocaleString()} m</output>
          </span>
          <input
            type="range"
            min={spec.height[0]}
            max={spec.height[1]}
            step={100}
            value={tool.heightM}
            onChange={(e) => onTool({ ...tool, heightM: Number(e.target.value) })}
          />
        </label>
        <label className="param">
          <span className="param-label">
            Radius
            <output>{(tool.radiusM / 1000).toFixed(1)} km</output>
          </span>
          <input
            type="range"
            min={spec.radius[0]}
            max={spec.radius[1]}
            step={500}
            value={tool.radiusM}
            onChange={(e) => onTool({ ...tool, radiusM: Number(e.target.value) })}
          />
        </label>
      </div>

      {blocked ? (
        <p className="realism fictional">{blocked}</p>
      ) : (
        <>
          <button type="button" className={placing ? "trigger placing" : "trigger"} onClick={onPlace}>
            {placing ? "Click the map… (Esc to cancel)" : `${spec.label}: click the map`}
          </button>
          {photoreal && <p className="fine">Sculpting switches to terrain view: Google's 3D mesh can't be reshaped.</p>}
        </>
      )}

      <section className="vent">
        <div className="vent-row">
          <div>
            <span className="eyebrow">Your edits</span>
            <strong>{edits.length ? `${edits.length} change${edits.length === 1 ? "" : "s"}` : "None yet"}</strong>
          </div>
          <div className="view-buttons">
            <button type="button" className="chip" onClick={onUndo} disabled={!edits.length || !!blocked}>
              Undo
            </button>
            <button type="button" className="chip" onClick={onClear} disabled={!edits.length || !!blocked}>
              Clear
            </button>
          </div>
        </div>
        <p className="fine">
          Lava flows around sculpted ground. Named volcanoes keep their real summits, and buildings on sculpted
          ground are hidden.
        </p>
      </section>
    </aside>
  );
});
