/**
 * Probe whether a demo clip actually exists before showing any UI around it.
 *
 * A fresh white-label deploy usually has no recording yet. A missing file can
 * come back as a real 404, or (behind CloudFront / the Vite dev server SPA
 * fallback) as a 200 serving index.html, so an HTML response counts as missing
 * too. Results are cached per src so the Help page and the player share one
 * request.
 */
import { useEffect, useState } from "react";

export type VideoAvailability = "checking" | "available" | "unavailable";

const probes = new Map<string, Promise<boolean>>();
const results = new Map<string, boolean>();

async function headLooksLikeVideo(src: string): Promise<boolean> {
  try {
    const response = await fetch(src, { method: "HEAD" });
    if (!response.ok) return false;
    const contentType = response.headers.get("content-type") ?? "";
    return !contentType.startsWith("text/html");
  } catch {
    return false;
  }
}

export function probeVideo(src: string): Promise<boolean> {
  const existing = probes.get(src);
  if (existing) return existing;
  const probe = headLooksLikeVideo(src).then((ok) => {
    results.set(src, ok);
    return ok;
  });
  probes.set(src, probe);
  return probe;
}

/** Record a clip that passed the probe but failed to load or decode in the player. */
export function markVideoUnavailable(src: string): void {
  results.set(src, false);
  probes.set(src, Promise.resolve(false));
}

/** Test helper: forget cached probe results. */
export function resetVideoProbeCache(): void {
  probes.clear();
  results.clear();
}

function knownAvailability(src: string | undefined): VideoAvailability {
  if (!src) return "unavailable";
  const known = results.get(src);
  if (known === undefined) return "checking";
  return known ? "available" : "unavailable";
}

export function useVideoAvailable(src: string | undefined): VideoAvailability {
  const [availability, setAvailability] = useState<VideoAvailability>(() => knownAvailability(src));

  useEffect(() => {
    if (!src) return undefined;
    let isActive = true;
    setAvailability(knownAvailability(src));
    probeVideo(src).then((ok) => {
      if (isActive) setAvailability(ok ? "available" : "unavailable");
    });
    return () => {
      isActive = false;
    };
  }, [src]);

  return src ? availability : "unavailable";
}
