# Feedback Manager: WCAG 2.1 AA audit notes

This folder implements the admin Feedback Manager (queue, trends, prompts). Use this checklist when changing these screens.

## Automated

- Run **axe DevTools** (or `@axe-core/react`) on:
  - `/admin/user-feedback`
  - `/admin/user-feedback/:feedbackId` (with a valid id)
- Fix **critical** and **serious** issues before merge.

## Keyboard (manual)

- Tab through header → tabs → queue filters → list rows → pagination.
- Open a feedback row (Enter/Space), complete fields, Save, close drawer (Esc and close button).
- Open Activity log drawer from timeline icon; close with Esc.
- Trends: activate a cluster card and “View example” without mouse.
- Instructions: draft list, “Ask AI to improve” dialog, publish confirm.

## Screen reader (spot-check)

- **VoiceOver** (Safari) or **NVDA** (Firefox): confirm tab names, list selection (`aria-selected` / `aria-current`), drawer titles (`aria-label`), and that notifications are announced (see `notif-flashbar`).

## Implemented patterns (baseline)

- **Notifications:** Per-alert `role` / `aria-live` (`assertive` for errors, `polite` for others) in `src/components/notif-flashbar.tsx`.
- **Loading:** A wrapping `Box` with `role="progressbar"` and `aria-label` around `LinearProgress` in Inbox and Prompt workspace (MUI `LinearProgress` typings omit `slotProps` in this project).
- **Detail / activity drawers:** `PaperProps` with `role="dialog"`, `aria-modal="true"`, and `aria-label`.
- **Inbox list:** `role="list"` / `listitem`, `aria-selected`, `aria-current` on the active row.
- **Trends clusters:** No keyboard trap when `sampleFeedbackId` is missing (`tabIndex={-1}`, `aria-disabled`).
- **Load failures:** Inbox, Trends and Instructions show an inline `Alert severity="error"` (role `alert`) with a Retry button (`LoadErrorAlert.tsx`) instead of an empty state.
- **Tinted panels:** “What was wrong” / “What they expected” use the theme's `error.light` / `success.light` tints with `.dark` label text in light mode and `.main` in dark mode; stacked-bar labels use `getContrastText` per segment.

## Open risks (re-verify after visual changes)

- **1.4.3 Contrast:** Small overline/caption text and tinted panels (`error.light` / `success.light`, top-3 document rows). Re-check with a contrast tool in both light and dark mode, especially after changing brand colors.
- **1.4.11:** Focus ring visibility on dense chip/toolbar controls.
- **Focus management:** MUI `Drawer`/`Dialog` default focus restore; regress after upgrading `@mui/material`.
