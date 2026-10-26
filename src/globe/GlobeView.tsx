import { useEffect, useRef } from "react";
import "cesium/Build/Cesium/Widgets/widgets.css";
import { createGlobe, type Globe } from "./createGlobe";

interface Props {
  ionToken: string | undefined;
  onReady: (globe: Globe) => void;
  onError: (message: string) => void;
}

/**
 * Mounts the Cesium viewer once and tears it down (GPU resources included) on
 * unmount. Fast-changing readouts (camera, tile loading) subscribe to the
 * viewer themselves in ui/LiveReadouts.tsx rather than going through here.
 */
export function GlobeView({ ionToken, onReady, onError }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Callbacks change identity on every App render; read the latest through a ref
  // so the viewer is not rebuilt each time.
  const handlers = useRef({ onReady, onError });
  handlers.current = { onReady, onError };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;
    let globe: Globe | undefined;

    createGlobe(container, ionToken)
      .then((created) => {
        if (cancelled) {
          created.viewer.destroy();
          return;
        }
        globe = created;
        handlers.current.onReady(created);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const detail = err instanceof Error ? err.message : String(err);
        handlers.current.onError(
          /webgl/i.test(detail)
            ? "This browser or graphics driver could not start WebGL, which the 3D globe needs."
            : `The globe failed to start: ${detail}`,
        );
      });

    return () => {
      cancelled = true;
      if (globe && !globe.viewer.isDestroyed()) globe.viewer.destroy();
    };
  }, [ionToken]);

  return <div ref={containerRef} className="globe" />;
}
