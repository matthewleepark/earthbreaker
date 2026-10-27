export type LeftTab = "disasters" | "sculpt";

/** The Disasters / Sculpt switch at the top of the left panel. */
export function PanelTabs({ active, onTab }: { active: LeftTab; onTab: (tab: LeftTab) => void }) {
  return (
    <div className="panel-tabs" role="tablist" aria-label="Mode">
      {(["disasters", "sculpt"] as const).map((tab) => (
        <button
          key={tab}
          type="button"
          role="tab"
          aria-selected={active === tab}
          className={active === tab ? "active" : ""}
          onClick={() => onTab(tab)}
        >
          {tab === "disasters" ? "Disasters" : "Sculpt"}
        </button>
      ))}
    </div>
  );
}
