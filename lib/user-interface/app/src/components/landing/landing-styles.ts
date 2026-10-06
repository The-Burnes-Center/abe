import { keyframes } from "@mui/system";

const fadeIn = keyframes`
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
`;

/** Fade-in that respects reduced-motion preferences. */
export const fadeInSx = (delay = 0) => ({
  animation: `${fadeIn} 0.75s ease-out ${delay}s both`,
  "@media (prefers-reduced-motion: reduce)": { animation: "none" },
});

/** Shared text style for the slide headings (white-on-brand, AA at any size). */
export const slideHeadingSx = {
  m: 0,
  fontWeight: 700,
  letterSpacing: "-0.02em",
  lineHeight: 1.15,
  textShadow: "0 1px 3px rgba(0,0,0,0.35)",
};
