/**
 * DemoVideo: a short, muted, looping product walkthrough clip.
 *
 * Used in two places: the Help page (click to play) and the one-time
 * onboarding dialog (auto-plays). We always render native controls so the
 * looping clip can be paused (WCAG 2.2.2).
 *
 * Renders nothing until the clip is confirmed to exist, and nothing at all if
 * it is missing or fails to load, so a deployment without a recording degrades
 * to text instead of a broken player.
 */
import { useEffect, useRef, useState } from "react";
import Box from "@mui/material/Box";
import useMediaQuery from "@mui/material/useMediaQuery";
import { brand } from "../../common/brand";
import { markVideoUnavailable, useVideoAvailable } from "./use-video-available";

/** Recorded at 1100x898: pin the box so layout doesn't jump before load. */
const ASPECT_RATIO = "1100 / 898";
const DEFAULT_LABEL =
  "Walkthrough: asking the assistant a question and getting an answer with linked sources.";

interface DemoVideoProps {
  /** Path to the clip (defaults to `brand.assets.demoVideo`). */
  src?: string;
  /** Begin playing on mount. Always muted; ignored under reduced-motion. */
  autoPlay?: boolean;
  /** Screen-reader description of the clip. */
  label?: string;
  /** Called once if the clip is missing or fails to load. */
  onUnavailable?: () => void;
}

export default function DemoVideo({
  src = brand.assets.demoVideo,
  autoPlay = false,
  label = DEFAULT_LABEL,
  onUnavailable,
}: DemoVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const availability = useVideoAvailable(src);
  const [hasLoadError, setHasLoadError] = useState(false);
  const isUnavailable = availability === "unavailable" || hasLoadError;

  // Respect users who prefer reduced motion: don't auto-animate for them.
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");

  useEffect(() => {
    setHasLoadError(false);
  }, [src]);

  useEffect(() => {
    if (isUnavailable) onUnavailable?.();
  }, [isUnavailable, onUnavailable]);

  // React doesn't reliably set the `muted` DOM property from the attribute,
  // and browsers only autoplay muted clips, so force it once the element mounts.
  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = true;
  }, [availability]);

  if (availability !== "available" || hasLoadError) return null;

  return (
    <Box
      component="video"
      ref={videoRef}
      src={src}
      muted
      loop
      playsInline
      controls
      preload="metadata"
      autoPlay={autoPlay && !reducedMotion}
      aria-label={label}
      onError={() => {
        if (src) markVideoUnavailable(src);
        setHasLoadError(true);
      }}
      sx={{
        display: "block",
        width: "100%",
        height: "auto",
        aspectRatio: ASPECT_RATIO,
        borderRadius: 2,
        border: "1px solid",
        borderColor: "divider",
        bgcolor: "common.black",
      }}
    />
  );
}
