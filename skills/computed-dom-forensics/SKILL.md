---
name: computed-dom-forensics
description: Use when debugging CSS layout bugs, horizontal/vertical overflow, z-index stacking issues, unclickable/covered buttons, sticky/fixed positioning failures, or mobile viewport misalignment. Prohibits blind CSS/Tailwind guessing and requires extracting real browser geometry before editing styles.
---

# Computed DOM Forensics

## Overview

Never guess CSS or Tailwind classes from static source code when debugging visual, layout, or interaction bugs. Static code does not reveal runtime viewport constraints, parent flex/grid shrinkage, stacking context traps, or invisible overlapping layers.

**Core principle:** Extract real browser geometry (`getBoundingClientRect`, `getComputedStyle`, `elementFromPoint`, and stacking contexts) BEFORE proposing or applying any style changes.

## The Iron Law

NO CSS OR TAILWIND LAYOUT FIXES WITHOUT A COMPUTED DOM SNAPSHOT FIRST

If you have not run the forensic script against the live local URL (or inspected the exact computed coordinates), you are guessing. Stop and capture the DOM telemetry first.

## When to Trigger This Skill

Activate this workflow immediately when the user reports:
- **Overflow / Scroll bugs:** "Page scrolls horizontally on mobile", "table breaks out of container", "double scrollbars".
- **Occlusion / Clickability bugs:** "Button cannot be clicked", "modal is behind the header", "`z-index: 9999` is not working".
- **Alignment & Sizing bugs:** "Element is squished", "height is 0", "sticky sidebar stops working", "broken on mobile viewport".
- **Visual Regression:** Layout shifts or unexpected spacing that does not match the intended design.

## The 4-Phase Forensic Workflow

### Phase 1: Capture Live Geometry
Run the bundled `dom-forensics.mjs` script against the running dev server. Pass the target selector if known, and always match the viewport where the bug occurs.

```bash
# Desktop inspection on a specific element
node "<path-to-skill>/scripts/dom-forensics.mjs" \
  --url "http://localhost:3000/dashboard" \
  --selector "button.submit-order" \
  --viewport "1440x900"

# Mobile overflow & full-page audit
node "<path-to-skill>/scripts/dom-forensics.mjs" \
  --url "http://localhost:3000" \
  --viewport "375x812"
```

### Phase 2: Analyze the Forensic Report
Read the compact JSON output from the script and check the four diagnostic sections:

**hitTest** (For unclickable or covered elements):

Look at `isOccluded`. If true, `topmostElementAtCenter` shows the exact DOM node stealing pointer events at the target's center (x, y) coordinate.

**ancestryChain** (For z-index, sticky, and sizing bugs):

Inspect parent nodes up to `<body>`.

- Sticky broken? Check if any ancestor has `overflow: hidden | auto | scroll` or a fixed height constraint.
- z-index ignored? Check which ancestor creates a `stackingContextReason` (e.g., transform, opacity < 1, filter, or `isolation: isolate`). A child's z-index cannot escape its parent's stacking context.

**overflowCulprits** (For horizontal scroll / broken mobile layouts):

Lists exact elements where `rect.right > viewport.width` or `scrollWidth > clientWidth`. Fix the specific culprit rather than slapping `overflow-x-hidden` on body.

**target.rect & target.styles** (For collapsed or misaligned nodes):

Compare `rect.width` / `rect.height` against `styles.display`, `styles.flexShrink`, and `styles.minWidth`.

### Phase 3: State the Mathematical Root Cause
Before editing any file, briefly state the root cause using the numbers from the JSON output.

Bad: "I'll increase the z-index and add overflow-hidden."

Good: ".checkout-btn at (320, 640) is occluded by .toast-container (pointer-events: auto, covering 0,600 to 375,700). Also, .sidebar has z-index: 50 inside <main> which creates a new stacking context via transform: translateZ(0)."

### Phase 4: Minimal Surgical Fix & Visual Diff Verification
1. Apply the smallest possible CSS/Tailwind change that resolves the mathematical root cause.
2. Re-run `dom-forensics.mjs` passing the existing `--baseline` and `--diff`:

```bash
node "<path-to-skill>/scripts/dom-forensics.mjs" \
  --url "http://localhost:3000/dashboard" \
  --selector "button.submit-order" \
  --viewport "375x812" \
  --annotate ".forensics/annotated-after.png" \
  --baseline ".forensics/baseline.png" \
  --diff ".forensics/diff.png"
```

3. **Verify Both Telemetry and Visual Diff:**
   - Confirm `overflowCulprits` is empty and `isOccluded` is false.
   - Inspect `visualArtifacts.diffComparison` in the JSON output and view `.forensics/diff.png` + `.forensics/annotated-after.png` with your file reader tool to ensure Magenta diff pixels (#ff00ff) are strictly confined to the intended layout fix without collateral layout shifts.

> If `diffPercentage` spikes above ~60% when you only intended to fix one small button, your CSS change accidentally shifted the whole page layout (collateral regression) — roll back immediately.

## Red Flags - Stop and Run Forensics
If you catch yourself about to do any of the following without running the script first, STOP:

- Adding `z-50` or `z-[9999]` hoping an element moves to the front.
- Adding `overflow-x-hidden` to body or main to hide horizontal scrollbars instead of fixing the overflowing child.
- Adding `!important` to override styles you haven't inspected.
- Guessing `w-full`, `min-w-0`, or `flex-1` combinations by trial and error.
