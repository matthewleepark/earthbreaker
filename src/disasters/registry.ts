import type { DisasterDefinition } from "./types";
import { volcanicEruption } from "./volcano/eruption";

const later = (id: string, name: string, category: string, description: string): DisasterDefinition => ({
  id,
  name,
  category,
  available: false,
  description,
  params: [],
  defaults: {},
  create: () => Promise.reject(new Error(`${name} is not built yet`)),
});

/** Everything shown in the disaster panel. Only available ones can be triggered. */
export const DISASTERS: DisasterDefinition[] = [
  volcanicEruption,
  later("meteor", "Meteor impact", "Space", "Incoming object, flash, shockwave and debris."),
  later("earthquake", "Earthquake", "Geological", "Ground shaking around an epicentre."),
  later("landslide", "Landslide", "Geological", "Rock, soil or snow sliding downhill."),
];
