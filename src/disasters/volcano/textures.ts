// Particle sprites drawn once on canvases, so there are no image files to ship.

let ashPuff: HTMLCanvasElement | undefined;
let glowDot: HTMLCanvasElement | undefined;

/**
 * A lumpy smoke puff: a cluster of soft blobs with a darker underside, so
 * overlapping puffs read as billowing volume rather than flat grey disks.
 */
export function ashPuffTexture(): HTMLCanvasElement {
  if (ashPuff) return ashPuff;
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const blobs = [
    [64, 64, 46], [44, 58, 30], [84, 56, 32], [60, 42, 28], [76, 78, 26], [46, 80, 24], [92, 74, 20], [36, 70, 18],
  ];
  for (const [x, y, r] of blobs) {
    const g = ctx.createRadialGradient(x - r * 0.25, y - r * 0.3, r * 0.1, x, y, r);
    g.addColorStop(0, "rgba(255,255,255,0.95)");
    g.addColorStop(0.55, "rgba(225,225,225,0.6)");
    g.addColorStop(1, "rgba(200,200,200,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // Shade the lower half so the light seems to come from above.
  ctx.globalCompositeOperation = "source-atop";
  const shade = ctx.createLinearGradient(0, 30, 0, size);
  shade.addColorStop(0, "rgba(0,0,0,0)");
  shade.addColorStop(1, "rgba(0,0,0,0.45)");
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, size, size);
  ashPuff = canvas;
  return canvas;
}

/** A bright core fading to transparent, used for ejecta, the vent glow and the flash. */
export function glowTexture(): HTMLCanvasElement {
  if (glowDot) return glowDot;
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.2, "rgba(255,255,255,0.85)");
  g.addColorStop(0.5, "rgba(255,255,255,0.25)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  glowDot = canvas;
  return canvas;
}

let chunks: HTMLCanvasElement[] | undefined;

/**
 * A few irregular rock silhouettes, shaded lighter on the upper left. They are
 * white-grey so a billboard colour can tint them to rock, ice or glowing lava.
 */
export function chunkTextures(): HTMLCanvasElement[] {
  if (chunks) return chunks;
  // Fixed seed so the shapes are the same every time.
  let s = 7;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  chunks = [0, 1, 2, 3].map(() => {
    const size = 64;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const corners = 7 + Math.floor(rand() * 4);
    ctx.beginPath();
    for (let i = 0; i < corners; i++) {
      const a = (i / corners) * Math.PI * 2 + rand() * 0.4;
      const r = size * (0.28 + rand() * 0.2);
      const x = size / 2 + Math.cos(a) * r;
      const y = size / 2 + Math.sin(a) * r * (0.7 + rand() * 0.3);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    const shade = ctx.createLinearGradient(10, 10, 54, 54);
    shade.addColorStop(0, "#ffffff");
    shade.addColorStop(0.55, "#b8b8b8");
    shade.addColorStop(1, "#5c5c5c");
    ctx.fillStyle = shade;
    ctx.fill();
    // A couple of facet lines so it reads as broken rock, not a blob.
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = 1.5;
    for (let k = 0; k < 2; k++) {
      ctx.beginPath();
      ctx.moveTo(size * (0.3 + rand() * 0.4), size * (0.3 + rand() * 0.2));
      ctx.lineTo(size * (0.35 + rand() * 0.35), size * (0.55 + rand() * 0.2));
      ctx.stroke();
    }
    return canvas;
  });
  return chunks;
}

let shockRing: HTMLCanvasElement | undefined;

/**
 * The blast wave. A shell of compressed air seen from any side is a circle
 * with a bright rim and a faint interior, so a camera-facing ring sprite reads
 * as a sphere expanding from the vent.
 */
export function shockRingTexture(): HTMLCanvasElement {
  if (shockRing) return shockRing;
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  // A bright condensation rim with a darker dust band just outside it, so the
  // ring stands out on both dark rock and bright snow.
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, "rgba(255,255,255,0.08)");
  g.addColorStop(0.68, "rgba(255,255,255,0.16)");
  g.addColorStop(0.86, "rgba(255,255,255,0.95)");
  g.addColorStop(0.91, "rgba(150,140,130,0.75)");
  g.addColorStop(0.96, "rgba(70,62,55,0.4)");
  g.addColorStop(1, "rgba(70,62,55,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  shockRing = canvas;
  return canvas;
}

/** Tileable-looking crust noise: dark speckles and cracks to break up the lava's grid. */
export function crustTexture(size: number, rng: () => number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  // Layers of random dark strokes at a few scales.
  for (const [count, width, alpha] of [[900, 1.2, 0.35], [260, 2.2, 0.25], [60, 4, 0.18]] as const) {
    for (let k = 0; k < count; k++) {
      const x = rng() * size;
      const y = rng() * size;
      const len = 3 + rng() * 14 * width;
      const a = rng() * Math.PI * 2;
      ctx.strokeStyle = `rgba(0,0,0,${alpha * (0.5 + rng() * 0.5)})`;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + Math.cos(a + 1) * len * 0.5, y + Math.sin(a + 1) * len * 0.5, x + Math.cos(a) * len, y + Math.sin(a) * len);
      ctx.stroke();
    }
  }
  return canvas;
}
