import type { DisasterDefinition } from "./types";
import { volcanicEruption } from "./volcano/eruption";
import { meteorImpact } from "./meteor/impact";

const later = (id: string, name: string, category: string, description: string): DisasterDefinition => ({
  id,
  name,
  category,
  siteLabel: "Location",
  available: false,
  description,
  params: [],
  defaults: {},
  create: () => Promise.reject(new Error(`${name} is not built yet`)),
});

/** Everything shown in the disaster panel. Only available ones can be triggered. */
export const DISASTERS: DisasterDefinition[] = [
  volcanicEruption,
  meteorImpact,
  later("earthquake", "Earthquake", "Geological", "Ground shaking around an epicentre."),
  later("landslide", "Landslide", "Geological", "Rock, soil or snow sliding downhill."),
];
