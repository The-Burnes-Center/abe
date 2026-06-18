/**
 * demo-kit — shared primitives for the PALETTE slide-ready UI mockups.
 *
 * These animated mockups are recording-only tooling (see scripts/record-demo.mjs).
 * They are NOT part of the shipped product surface: the `/demo-animation` route is
 * mounted in main.tsx *before* the Cognito auth gate so a headless browser can load
 * it directly, and nothing here talks to the backend.
 *
 * Everything is self-contained — design tokens are copied verbatim from
 * common/theme.ts (light mode) and styles/chat.module.scss so a demo renders
 * identically whether or not the app's global CSS-var injection has run.
 */
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";

/* ── PALETTE light-mode palette (verbatim from common/theme.ts) ───────────────── */
export const PALETTE = {
  primary: "#14558F",
  primaryDark: "#0A3D6B",
  primaryLight: "#E8F2FC",
  primaryContrast: "#FFFFFF",
  secondary: "#D97706",
  secondaryLight: "#FEF3C7",
  surface: "#FFFFFF",
  surfaceAlt: "#F7F8FA",
  paper: "#FFFFFF",
  border: "#E2E5EA",
  borderSubtle: "#EEF0F3",
  textPrimary: "#1A1D23",
  textSecondary: "#555D6B",
  textTertiary: "#6B7280",
  headerBg: "#0B2847",
  headerText: "#FFFFFF",
  sidebarBg: "#FBFBFC",
  chatHumanBg: "#14558F",
  chatHumanText: "#FFFFFF",
  chatAiBg: "#F7F8FA",
  chatAiBorder: "#E8EDF2",
  success: "#0D7C3F",
  successLight: "#ECFDF3",
  warning: "#B45309",
  warningLight: "#FFFBEB",
  error: "#C4320A",
  errorLight: "#FEF3F2",
  info: "#0B6BCB",
  infoLight: "#EBF5FF",
  codeBlockBg: "#F4F5F7",
  tableBorder: "#E2E5EA",
  tableHeaderBg: "#F2F4F7",
  tableStripeBg: "#FAFBFC",
} as const;

export const FONT_STACK =
  '"Inter","Open Sans","Helvetica Neue",Roboto,Arial,sans-serif';

/* ── base CSS: scoped --abe vars, fonts, keyframes, browser chrome, cursor ── */
export const BASE_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

.app-demo-root {
  --app-primary:${PALETTE.primary}; --app-primaryDark:${PALETTE.primaryDark};
  --app-primaryLight:${PALETTE.primaryLight}; --app-primaryContrast:${PALETTE.primaryContrast};
  --app-secondary:${PALETTE.secondary}; --app-secondaryLight:${PALETTE.secondaryLight};
  --app-surface:${PALETTE.surface}; --app-surfaceAlt:${PALETTE.surfaceAlt}; --app-paper:${PALETTE.paper};
  --app-border:${PALETTE.border}; --app-borderSubtle:${PALETTE.borderSubtle};
  --app-textPrimary:${PALETTE.textPrimary}; --app-textSecondary:${PALETTE.textSecondary};
  --app-textTertiary:${PALETTE.textTertiary};
  --app-chatHumanBg:${PALETTE.chatHumanBg}; --app-chatHumanText:${PALETTE.chatHumanText};
  --app-chatAiBg:${PALETTE.chatAiBg}; --app-chatAiBorder:${PALETTE.chatAiBorder};
  --app-success:${PALETTE.success}; --app-successLight:${PALETTE.successLight};
  --app-warning:${PALETTE.warning}; --app-warningLight:${PALETTE.warningLight};
  --app-error:${PALETTE.error}; --app-errorLight:${PALETTE.errorLight};
  --app-info:${PALETTE.info}; --app-infoLight:${PALETTE.infoLight};
  --app-codeBlockBg:${PALETTE.codeBlockBg};
  --app-tableBorder:${PALETTE.tableBorder}; --app-tableHeaderBg:${PALETTE.tableHeaderBg};
  --app-tableStripeBg:${PALETTE.tableStripeBg};
  --app-hoverBg:rgba(0,0,0,0.04);
  --app-radius-xs:4px; --app-radius-sm:8px; --app-radius-md:12px;
  --app-radius-lg:16px; --app-radius-xl:24px;
  --app-shadow-xs:0 1px 2px rgba(0,0,0,0.05);
  --app-shadow-sm:0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.06);
  --app-shadow-md:0 4px 12px rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.04);
  --app-shadow-lg:0 8px 24px rgba(0,0,0,0.10), 0 4px 8px rgba(0,0,0,0.04);
  --app-transition-fast:150ms cubic-bezier(0.4,0,0.2,1);
  font-family:${FONT_STACK};
  color:${PALETTE.textPrimary};
  -webkit-font-smoothing:antialiased;
  text-rendering:optimizeLegibility;
}

/* recorder canvas: clean white, top-aligned, no gradient / tagline */
.app-demo-outer {
  min-height:100vh; box-sizing:border-box; background:#ffffff;
  padding:20px; display:flex; justify-content:center; align-items:flex-start;
}

.app-demo-card {
  background:${PALETTE.surface};
  border:1px solid ${PALETTE.border};
  border-radius:14px;
  box-shadow:0 18px 48px rgba(11,40,71,0.14), 0 6px 16px rgba(11,40,71,0.06);
  overflow:hidden;
  animation:abeCardIn 360ms cubic-bezier(0.4,0,0.2,1) both;
}

/* faux browser chrome */
.app-browserbar {
  display:flex; align-items:center; gap:8px;
  padding:11px 14px; background:#F2F4F7;
  border-bottom:1px solid ${PALETTE.border};
}
.app-dot { width:11px; height:11px; border-radius:50%; flex-shrink:0; }
.app-dot.r { background:#FF5F57; } .app-dot.y { background:#FEBC2E; } .app-dot.g { background:#28C840; }
.app-urlbar {
  flex:1; display:flex; align-items:center; gap:7px;
  margin-left:8px; padding:6px 12px; min-width:0;
  background:#FFFFFF; border:1px solid ${PALETTE.border}; border-radius:8px;
  font-size:12.5px; color:${PALETTE.textSecondary}; font-weight:500;
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
}
.app-urlbar .host { color:${PALETTE.textPrimary}; }
.app-urlbar svg { flex-shrink:0; color:${PALETTE.success}; }

.app-demo-body { position:relative; background:${PALETTE.surface}; }

/* simulated mouse cursor (recording artifact, not app UI) */
.app-cursor {
  position:absolute; top:0; left:0; z-index:9000; pointer-events:none;
  transform:translate(-3px,-2px);
  transition:left 520ms cubic-bezier(0.5,0,0.2,1), top 520ms cubic-bezier(0.5,0,0.2,1);
  filter:drop-shadow(0 1px 2px rgba(0,0,0,0.35));
  will-change:left,top;
}
.app-cursor.click .app-cursor-arrow { transform:scale(0.82); }
.app-cursor-arrow { transition:transform 120ms ease; transform-origin:top left; }
.app-cursor-ring {
  position:absolute; top:-6px; left:-6px; width:24px; height:24px;
  border-radius:50%; border:2px solid ${PALETTE.primary}; opacity:0;
}
.app-cursor.click .app-cursor-ring { animation:abeClickRing 460ms ease-out; }

@keyframes abeClickRing {
  0% { opacity:0.6; transform:scale(0.2); }
  100% { opacity:0; transform:scale(1.5); }
}
@keyframes abeCardIn { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:none; } }
@keyframes slideUp { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:none; } }
@keyframes fadeIn { from { opacity:0; } to { opacity:1; } }
@keyframes appRise { from { opacity:0; transform:translateY(14px); } to { opacity:1; transform:none; } }
@keyframes blinkCursor { 0%,100% { opacity:1; } 50% { opacity:0; } }
@keyframes abeSpin { to { transform:rotate(360deg); } }
@keyframes abeGrowW { from { width:0; } }
@keyframes abePulse { 0%,100% { opacity:1; } 50% { opacity:0.45; } }
`;

/* ── small inline spinner that matches MUI CircularProgress (size=14) ─────── */
export function Spinner({ size = 14, color = PALETTE.primary }: { size?: number; color?: string }) {
  return (
    <span
      aria-hidden
      style={{
        display: "inline-block",
        width: size,
        height: size,
        border: `${Math.max(2, Math.round(size / 7))}px solid ${color}`,
        borderTopColor: "transparent",
        borderRadius: "50%",
        animation: "abeSpin 0.8s linear infinite",
        verticalAlign: "middle",
      }}
    />
  );
}

/* ── step engine: advances through TIMINGS and loops forever ──────────────── */
export function useSteps(timings: number[]): number {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const id = setTimeout(
      () => setStep((s) => (s + 1) % timings.length),
      timings[step]
    );
    return () => clearTimeout(id);
  }, [step, timings]);
  // Expose the current step so the recorder can trim each clip to a clean loop
  // that STARTS at step 0 (see scripts/record-demo.mjs › waitForStep0).
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__STEP__ = step;
  }, [step]);
  return step;
}

/** Sum of TIMINGS — exported so the recorder can compute LOOP_MS. */
export const loopMs = (timings: number[]) => timings.reduce((a, b) => a + b, 0);

/* ── cursor position helper ───────────────────────────────────────────────── */
export type Pos = { x: number; y: number };

/** Center of `el` expressed in the coordinate space of `container`. */
export function centerOf(
  el: HTMLElement | null,
  container: HTMLElement | null
): Pos | null {
  if (!el || !container) return null;
  const e = el.getBoundingClientRect();
  const c = container.getBoundingClientRect();
  return { x: e.left - c.left + e.width / 2, y: e.top - c.top + e.height / 2 };
}

/**
 * Drives the simulated cursor toward a target element, one per step. Pass a map
 * of `step -> CSS selector`; on each step the cursor glides to that element's
 * center, measured live via getBoundingClientRect (never hardcoded pixels).
 * Mark targets in JSX with `data-cursor="..."` and select `[data-cursor="..."]`.
 * `clickSteps` lists which steps should also play the click ripple.
 */
export function useCursor(
  step: number,
  containerRef: RefObject<HTMLElement | null>,
  targets: Record<number, string>,
  clickSteps: number[] = []
) {
  const [pos, setPos] = useState<Pos | null>(null);
  const [clicking, setClicking] = useState(false);

  useEffect(() => {
    const sel = targets[step];
    if (sel) {
      // rAF so the target for this step has been laid out before we measure.
      const raf = requestAnimationFrame(() => {
        const el = containerRef.current?.querySelector(sel) as HTMLElement | null;
        const p = centerOf(el, containerRef.current);
        if (p) setPos(p);
      });
      return () => cancelAnimationFrame(raf);
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  useEffect(() => {
    if (clickSteps.includes(step)) {
      // fire the ripple slightly after the cursor has glided into place
      const on = setTimeout(() => setClicking(true), 430);
      const off = setTimeout(() => setClicking(false), 900);
      return () => {
        clearTimeout(on);
        clearTimeout(off);
      };
    }
    setClicking(false);
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  return { pos, clicking };
}

/* ── components ───────────────────────────────────────────────────────────── */
export function MouseCursor({ pos, clicking }: { pos: Pos | null; clicking: boolean }) {
  if (!pos) return null;
  return (
    <div
      className={`app-cursor${clicking ? " click" : ""}`}
      style={{ left: pos.x, top: pos.y }}
    >
      <span className="app-cursor-ring" />
      <svg className="app-cursor-arrow" width="22" height="22" viewBox="0 0 24 24" fill="none">
        <path
          d="M5.5 3.2 L19 12.4 L12.3 13.1 L9.2 19.6 Z"
          fill="#1A1D23"
          stroke="#FFFFFF"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

function LockGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 1a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2h-1V6a5 5 0 0 0-5-5Zm3 8H9V6a3 3 0 0 1 6 0v3Z" />
    </svg>
  );
}

/**
 * Faux browser window. `url` may change across phases (a changing URL aligned
 * with a button "loading" state reads as a router navigation). `width` is the
 * card width; the recorder viewport is sized to width + 40 (see registry).
 */
export function DemoFrame({
  url,
  width = 1040,
  bodyHeight = 700,
  bodyRef,
  children,
}: {
  url: string;
  width?: number;
  /** Fixed body height (px). Fixed — not min — so AppShell height:100% resolves
   *  and the content area can't reflow/shrink mid-animation. */
  bodyHeight?: number;
  bodyRef?: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}) {
  const host = "app.example.gov";
  const path = url.startsWith("/") ? url : `/${url}`;
  return (
    <div className="app-demo-outer">
      <div className="app-demo-card" style={{ width }}>
        <div className="app-browserbar">
          <span className="app-dot r" />
          <span className="app-dot y" />
          <span className="app-dot g" />
          <div className="app-urlbar">
            <LockGlyph />
            <span><span className="host">{host}</span>{path}</span>
          </div>
        </div>
        <div
          className="app-demo-body"
          ref={bodyRef as RefObject<HTMLDivElement>}
          style={{ height: bodyHeight, overflow: "hidden" }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

/** Inject BASE_CSS once. Demos add their own &lt;style&gt; for extra rules. */
export function DemoStyle({ css }: { css?: string }) {
  return <style>{BASE_CSS + (css ?? "")}</style>;
}
