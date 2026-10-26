import { useEffect, useRef } from "react";
import { Math as CesiumMath } from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import { createGlobe, type Globe } from "./createGlobe";

export interface CameraReadout {
  lat: number;
  lon: number;
  altitudeM: number;
}

interface Props {
  ionToken: string | undefined;
  onReady: (globe: Globe) => void;
  onError: (message: string) => void;
  onCamera: (readout: CameraReadout) => void;
  onTilesPending: (count: number) => void;
}

/** Mounts the Cesium viewer once and tears it down (GPU resources included) on unmount. */
export function GlobeView({ ionToken, onReady, onError, onCamera, onTilesPending }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Callbacks change identity on every App render; read the latest through a ref
  // so the viewer is not rebuilt each time.
  const handlers = useRef({ onReady, onError, onCamera, onTilesPending });
  handlers.current = { onReady, onError, onCamera, onTilesPending };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;
    let globe: Globe | undefined;
    const cleanups: Array<() => void> = [];

    createGlobe(container, ionToken)
      .then((created) => {
        if (cancelled) {
          created.viewer.destroy();
          return;
        }
        globe = created;
        const { viewer } = created;

        viewer.camera.percentageChanged = 0.002;
        const report = () => {
          const c = viewer.camera.positionCartographic;
          handlers.current.onCamera({
            lat: CesiumMath.toDegrees(c.latitude),
            lon: CesiumMath.toDegrees(c.longitude),
            altitudeM: c.height,
          });
        };
        cleanups.push(viewer.camera.changed.addEventListener(report));
        cleanups.push(
          viewer.scene.globe.tileLoadProgressEvent.addEventListener((pending: number) =>
            handlers.current.onTilesPending(pending),
          ),
        );
        report();
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
      cleanups.forEach((remove) => remove());
      if (globe && !globe.viewer.isDestroyed()) globe.viewer.destroy();
    };
  }, [ionToken]);

  return <div ref={containerRef} className="globe" />;
}
