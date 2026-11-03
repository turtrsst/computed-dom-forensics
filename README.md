# 🔬 computed-dom-forensics

**Stop your AI coding agent from blindly guessing CSS and Tailwind classes.**

[![Agent Skills Compatible](https://img.shields.io/badge/npx_skills-compatible-black?style=flat-square)](https://skills.sh)
[![Claude Code Plugin](https://img.shields.io/badge/Claude_Code-Plugin-d97757?style=flat-square)](https://docs.anthropic.com)
[![Zero Extra Dependencies](https://img.shields.io/badge/dependencies-playwright_only-2ea44f?style=flat-square)](#)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)

`computed-dom-forensics` is an agentic skill and ultra-lightweight Playwright CLI telemetry engine for **Claude Code**, **Cursor**, **Windsurf**, **OpenCode**, and **Codex CLI**.

When you ask an LLM to fix a broken mobile layout, an unclickable button, or a `z-index` bug, it usually guesses from static code—slapping `overflow-x-hidden` on `<body>` or `z-[9999]` on a component without knowing the actual runtime geometry. **`computed-dom-forensics` enforces an Iron Law:** the agent must capture real browser coordinates, stacking contexts, pointer hit-tests, and annotated HUD screenshots *before* touching a single line of CSS.

---

## ⚡ Why Agents Need This

| Common Frontend Bug | Typical Blind AI Behavior ❌ | With `computed-dom-forensics` ✅ |
| :--- | :--- | :--- |
| **Unclickable button / Modal overlap** | Randomly bumps `z-50` to `z-[9999]` or removes `relative`. | Runs center-point `elementFromPoint(cx, cy)` hit-test and walks the DOM ancestry to find the exact parent creating a `transform` / `opacity` stacking context trap. |
| **Unwanted horizontal scroll on mobile** | Hides the symptom by adding `overflow-x-hidden` to `body`. | Scans all DOM nodes, ranks the top `overflowCulprits` where `rect.right > viewport.width`, and pinpoints the exact child overflowing by `+XXpx`. |
| **Sticky element not sticking** | Rewrites `sticky top-0` to `fixed` and breaks layout flow. | Walks the `ancestryChain` up to `<html>` to detect which parent container has a conflicting `overflow: hidden/auto` or constrained height. |
| **Collateral visual regressions** | Fixes one button but shifts the entire page layout without noticing. | Captures a clean **Baseline (`baseline.png`)** and generates an in-browser HTML5 Canvas **Visual Diff (`diff.png`)** highlighting changed pixels in Magenta (`#ff00ff`). |

---

## 📦 Installation

### Option 1: Install via `npx skills` (Recommended for Cursor, Claude Code, OpenCode, Windsurf)

Install directly into your project or global agent skills directory using the standard skills CLI:

```bash
npx skills add <your-github-username>/computed-dom-forensics
```

### Option 2: Install as a Claude Code Plugin

Inside a Claude Code session, register and install the plugin directly:

```bash
/plugin install github:<your-github-username>/computed-dom-forensics
```

### Option 3: Manual Clone & Local Setup

```bash
git clone https://github.com/<your-github-username>/computed-dom-forensics.git
cd computed-dom-forensics
npm install
npx playwright install chromium
```

> **Note:** Make sure `.forensics/` is added to your project's `.gitignore` so temporary screenshots and visual diffs are not committed:
> ```bash
> echo ".forensics/" >> .gitignore
> ```

---

## 🖼️ Multimodal HUD & Visual Diff Architecture

Unlike heavy visual testing suites that require native C++ binaries or external image processing libraries (`sharp`, `pixelmatch`, `pngjs`), `computed-dom-forensics` runs **100% inside Playwright's Chromium engine**:

1. **Annotated Forensic HUD (`.forensics/annotated.png`):**
   Injects a zero-interference fixed overlay (`#__dom_forensics_hud__`) right before taking a screenshot so multimodal models (Claude, GPT-4o, Gemini) can literally *see* the geometry:
   * 🟥 **Red Box (`OVERFLOW #n`):** Elements spilling past the right or left edge of the viewport, labeled with exact `+XXpx` overflow.
   * 🟦 **Cyan Box (`TARGET`):** The target element inspected via `--selector`, labeled with its computed `WxH` dimensions.
   * 🟧 **Orange Box (`OCCLUDER`) + Red Target Dot:** If the target is covered by another layer (`isOccluded: true`), highlights the exact blocking DOM node and marks the blocked click coordinate `(cx, cy)`.

2. **Zero-Dependency Canvas Diff (`.forensics/diff.png`):**
   Compares `.forensics/baseline.png` (captured before edits) against the current state after CSS fixes. Unchanged pixels are dimmed into subtle grayscale, while modified pixels light up in **Vivid Magenta (`#ff00ff`)** inside a **Cyan Bounding Box**—giving the agent instant proof that its fix was surgical.

---

## 🚀 Usage Guide: Claude Code & Cursor

Once installed, the skill activates automatically whenever you describe a layout, overflow, alignment, or clickability bug.

### Using in Claude Code

1. Make sure your local dev server is running (e.g., `npm run dev` on `http://localhost:3000`).
2. Prompt Claude Code naturally:
   > *"On mobile viewport (375x812), the `/checkout` page scrolls horizontally and the `.pay-now-btn` cannot be clicked. Use `computed-dom-forensics` to diagnose and fix it."*
3. **What Claude Code will do automatically:**
   * Execute `dom-forensics.mjs` with `--viewport 375x812 --selector ".pay-now-btn" --annotate .forensics/annotated-before.png --baseline .forensics/baseline.png`.
   * Use its built-in **`Read` tool** to visually inspect `.forensics/annotated-before.png` alongside the JSON telemetry.
   * Report the mathematical root cause (e.g., *"`.promo-banner` overflows the 375px viewport by +42px, and `.pay-now-btn` at (187, 760) is occluded by `.cookie-backdrop`"*).
   * Apply the minimal CSS/Tailwind fix.
   * Re-run `dom-forensics.mjs` with `--diff .forensics/diff.png` and read the diff image to verify zero collateral layout damage.

### Using in Cursor (Agent Mode)

1. If you installed via `npx skills add`, Cursor will load `SKILL.md` automatically. (Alternatively, symlink or copy `skills/computed-dom-forensics/SKILL.md` into `.cursor/rules/computed-dom-forensics.mdc`).
2. In **Cursor Composer / Agent Mode**, attach or mention the localhost URL and bug description:
   > *"The sticky sidebar on `http://localhost:3000/docs` stops sticking when scrolling down, and the code table breaks out of the flex container on 768x1024."*
3. Cursor's Agent will run the terminal command, inspect both the JSON output and `.forensics/annotated-before.png`, and fix the exact parent container causing the flex shrinkage or overflow trap.

---

## 🛠️ Standalone CLI Reference

You (or your agent) can also run the forensic script directly from any terminal:

```bash
node skills/computed-dom-forensics/scripts/dom-forensics.mjs [options]
```

### CLI Options

| Flag | Short | Default | Description |
| :--- | :---: | :---: | :--- |
| `--url <url>` | `-u` | *(Required)* | Full URL of the running web page (e.g., `http://localhost:3000`). |
| `--selector <css>` | `-s` | `undefined` | Target CSS selector for deep inspection, hit-testing, and ancestry walk. |
| `--viewport <WxH>` | `-v` | `1280x800` | Viewport dimensions in pixels (e.g., `375x812` for iPhone, `1440x900` for Desktop). |
| `--wait <ms>` | `-w` | `500` | Extra wait time in milliseconds after load for animations/hydration to settle. |
| `--annotate <path>` | `-a` | `undefined` | Output path for the HUD-annotated screenshot (e.g., `.forensics/annotated.png`). |
| `--baseline <path>` | `-b` | `undefined` | Path to save (if missing) or compare against a clean baseline screenshot. |
| `--diff <path>` | `-d` | `undefined` | Output path for the Magenta pixel-diff image when `--baseline` already exists. |
| `--fullPage` | — | `false` | Capture full scrollable page height in screenshots instead of just the viewport. |

### Example Workflow Commands

**1. Before Fix (Capture Telemetry + Baseline + Annotated HUD):**
```bash
node skills/computed-dom-forensics/scripts/dom-forensics.mjs \
  --url "http://localhost:3000/pricing" \
  --selector "#cta-subscribe" \
  --viewport "375x812" \
  --annotate ".forensics/before-hud.png" \
  --baseline ".forensics/baseline.png"
```

**2. After Fix (Verify Geometry + Generate Visual Diff):**
```bash
node skills/computed-dom-forensics/scripts/dom-forensics.mjs \
  --url "http://localhost:3000/pricing" \
  --selector "#cta-subscribe" \
  --viewport "375x812" \
  --annotate ".forensics/after-hud.png" \
  --baseline ".forensics/baseline.png" \
  --diff ".forensics/diff.png"
```

---

## 📊 Sample JSON Telemetry Output

The CLI outputs token-compact JSON tailored for LLM context windows:

```json
{
  "viewport": {
    "width": 375,
    "height": 812,
    "documentScrollWidth": 418,
    "documentScrollHeight": 1640,
    "hasUnintendedHorizontalScroll": true
  },
  "overflowCulprits": [
    {
      "node": "pre.code-snippet.bg-slate-900.p-4",
      "rect": { "x": 16, "y": 420, "width": 402, "height": 180, "top": 420, "right": 418, "bottom": 600, "left": 16 },
      "overflowRightPx": 43,
      "computedWidth": "402px",
      "minWidth": "auto",
      "whiteSpace": "pre"
    }
  ],
  "target": {
    "node": "button#cta-subscribe.btn-primary",
    "rect": { "x": 24, "y": 730, "width": 327, "height": 48, "top": 730, "right": 351, "bottom": 778, "left": 24 },
    "isZeroSize": false,
    "styles": {
      "display": "inline-flex",
      "position": "relative",
      "zIndex": "10",
      "overflowX": "visible",
      "overflowY": "visible",
      "width": "327px",
      "height": "48px",
      "minWidth": "0px",
      "maxWidth": "none",
      "flex": "0 1 auto",
      "pointerEvents": "auto",
      "opacity": "1"
    },
    "stackingContextReason": "position:relative + z-index:10",
    "hitTest": {
      "centerPoint": { "x": 188, "y": 754 },
      "inViewport": true,
      "isOccluded": true,
      "topmostElementAtCenter": "div.floating-chat-wrapper.fixed.inset-x-0",
      "topmostRect": { "x": 0, "y": 700, "width": 375, "height": 112, "top": 700, "right": 375, "bottom": 812, "left": 0 },
      "topmostStyles": {
        "display": "block",
        "position": "fixed",
        "zIndex": "50",
        "pointerEvents": "auto",
        "opacity": "1"
      }
    },
    "ancestryChain": [
      {
        "node": "section.pricing-card.relative",
        "rect": { "x": 16, "y": 280, "width": 343, "height": 520, "top": 280, "right": 359, "bottom": 800, "left": 16 },
        "display": "flex",
        "position": "relative",
        "zIndex": "auto",
        "overflow": "hidden/hidden",
        "stackingContextReason": "transform"
      }
    ]
  },
  "visualArtifacts": {
    "diffComparison": {
      "baselineUsed": "/workspace/app/.forensics/baseline.png",
      "diffImagePath": "/workspace/app/.forensics/diff.png",
      "changedPixels": 8420,
      "diffPercentage": 2.765,
      "changedBoundingBox": { "x": 16, "y": 420, "width": 359, "height": 380 }
    },
    "annotatedScreenshot": "/workspace/app/.forensics/after-hud.png"
  }
}
```

---

## 🤝 Contributing & License

PRs for additional layout heuristics (such as CSS Grid track blowout detection or sub-pixel font clipping) are welcome!

Licensed under the **MIT License**.
