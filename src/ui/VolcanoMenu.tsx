import { memo, useEffect, useMemo, useRef, useState } from "react";
import { REGIONS, VOLCANOES, type Volcano } from "../data/volcanoes";

interface Props {
  disabled: boolean;
  onPick: (volcano: Volcano) => void;
}

/** "Volcanoes ▾" in the top bar: famous volcanoes grouped by region, with a filter. */
export const VolcanoMenu = memo(function VolcanoMenu({ disabled, onPick }: Props) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    // Close on a click anywhere else, or Escape.
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
  }, [open]);

  const groups = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const matches = VOLCANOES.filter(
      (v) => !q || v.name.toLowerCase().includes(q) || v.country.toLowerCase().includes(q) || v.region.toLowerCase().includes(q),
    );
    return REGIONS.map((region) => ({ region, items: matches.filter((v) => v.region === region) })).filter((g) => g.items.length);
  }, [filter]);

  return (
    <div className="volcano-menu" ref={root}>
      <button
        type="button"
        className={open ? "chip active" : "chip"}
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        Volcanoes ▾
      </button>
      {open && (
        <div className="volcano-list" role="listbox" aria-label="Famous volcanoes">
          <input
            ref={input}
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={`Filter ${VOLCANOES.length} volcanoes`}
            aria-label="Filter volcanoes"
          />
          <div className="volcano-scroll">
            {groups.map(({ region, items }) => (
              <section key={region}>
                <h3>{region}</h3>
                {items.map((volcano) => (
                  <button
                    key={volcano.id}
                    type="button"
                    role="option"
                    aria-selected={false}
                    onClick={() => {
                      setOpen(false);
                      setFilter("");
                      onPick(volcano);
                    }}
                  >
                    <strong>{volcano.name}</strong>
                    <span>
                      {volcano.country} · {volcano.note}
                    </span>
                  </button>
                ))}
              </section>
            ))}
            {!groups.length && <p className="fine">No volcano matches “{filter}”.</p>}
          </div>
        </div>
      )}
    </div>
  );
});
