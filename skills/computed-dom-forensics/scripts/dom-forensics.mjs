#!/usr/bin/env node

import { parseArgs } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const { values } = parseArgs({
  options: {
    url: { type: 'string', short: 'u' },
    selector: { type: 'string', short: 's' },
    viewport: { type: 'string', short: 'v', default: '1280x800' },
    wait: { type: 'string', short: 'w', default: '500' },
    annotate: { type: 'string', short: 'a' }, // e.g. ".forensics/annotated.png"
    baseline: { type: 'string', short: 'b' }, // e.g. ".forensics/baseline.png"
    diff: { type: 'string', short: 'd' },     // e.g. ".forensics/diff.png"
    fullPage: { type: 'boolean', default: false },
  },
});

if (!values.url) {
  console.error(
    'Usage: node dom-forensics.mjs --url <http://localhost:3000> [--selector <css>] [--viewport <WxH>] [--annotate .forensics/annotated.png] [--baseline .forensics/baseline.png] [--diff .forensics/diff.png]'
  );
  process.exit(1);
}

const [width, height] = values.viewport.split('x').map(Number);
const waitMs = parseInt(values.wait, 10) || 500;

async function ensureDir(filePath) {
  if (!filePath) return;
  await fs.mkdir(path.dirname(path.resolve(filePath)), { recursive: true });
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width, height } });

  try {
    await page.goto(values.url, { waitUntil: 'networkidle', timeout: 15000 }).catch(() => {
      return page.goto(values.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    });
    await page.waitForTimeout(waitMs);

    // STEP 1: Compute DOM Geometry & Forensics Data
    const report = await page.evaluate(
      ({ selector, vw, vh }) => {
        const describeNode = (el) => {
          if (!el || el.nodeType !== 1) return null;
          const id = el.id ? `#${el.id}` : '';
          const classes =
            typeof el.className === 'string' && el.className.trim()
              ? '.' + el.className.trim().split(/\s+/).slice(0, 4).join('.')
              : '';
          return `${el.tagName.toLowerCase()}${id}${classes}`;
        };

        const roundRect = (r) => ({
          x: Math.round(r.x),
          y: Math.round(r.y),
          width: Math.round(r.width),
          height: Math.round(r.height),
          top: Math.round(r.top),
          right: Math.round(r.right),
          bottom: Math.round(r.bottom),
          left: Math.round(r.left),
        });

        const getStackingContextReason = (cs) => {
          const reasons = [];
          if (
            ['absolute', 'relative', 'fixed', 'sticky'].includes(cs.position) &&
            cs.zIndex !== 'auto'
          ) {
            reasons.push(`position:${cs.position} + z-index:${cs.zIndex}`);
          } else if (cs.position === 'fixed' || cs.position === 'sticky') {
            reasons.push(`position:${cs.position}`);
          }
          if (parseFloat(cs.opacity) < 1) reasons.push(`opacity:${cs.opacity}`);
          if (cs.transform !== 'none') reasons.push('transform');
          if (cs.filter !== 'none') reasons.push('filter');
          if (cs.backdropFilter && cs.backdropFilter !== 'none') reasons.push('backdrop-filter');
          if (cs.isolation === 'isolate') reasons.push('isolation:isolate');
          if (cs.willChange && cs.willChange !== 'auto') reasons.push(`will-change:${cs.willChange}`);
          return reasons.length > 0 ? reasons.join(', ') : null;
        };

        const extractKeyStyles = (cs) => ({
          display: cs.display,
          position: cs.position,
          zIndex: cs.zIndex,
          overflowX: cs.overflowX,
          overflowY: cs.overflowY,
          width: cs.width,
          height: cs.height,
          minWidth: cs.minWidth,
          maxWidth: cs.maxWidth,
          flex: `${cs.flexGrow} ${cs.flexShrink} ${cs.flexBasis}`,
          pointerEvents: cs.pointerEvents,
          opacity: cs.opacity,
        });

        const overflowCulprits = [];
        const allElements = document.querySelectorAll('*');
        for (const el of allElements) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) continue;
          if (r.right > vw + 1 || r.left < -1) {
            const cs = window.getComputedStyle(el);
            overflowCulprits.push({
              node: describeNode(el),
              rect: roundRect(r),
              overflowRightPx: Math.round(r.right - vw),
              computedWidth: cs.width,
              minWidth: cs.minWidth,
              whiteSpace: cs.whiteSpace,
            });
          }
        }

        overflowCulprits.sort((a, b) => b.overflowRightPx - a.overflowRightPx);
        const topOverflowCulprits = overflowCulprits.slice(0, 8);

        let targetForensics = null;
        if (selector) {
          const el = document.querySelector(selector);
          if (!el) {
            targetForensics = { error: `Selector "${selector}" not found in DOM.` };
          } else {
            const r = el.getBoundingClientRect();
            const cs = window.getComputedStyle(el);

            const cx = r.left + r.width / 2;
            const cy = r.top + r.height / 2;
            const inViewport = cx >= 0 && cx <= vw && cy >= 0 && cy <= vh;
            const topEl = inViewport ? document.elementFromPoint(cx, cy) : null;
            const isOccluded = topEl ? !(el === topEl || el.contains(topEl)) : false;

            const ancestryChain = [];
            let curr = el.parentElement;
            while (curr && curr !== document.documentElement) {
              const pcs = window.getComputedStyle(curr);
              const scReason = getStackingContextReason(pcs);
              const hasOverflowClip =
                pcs.overflowX !== 'visible' || pcs.overflowY !== 'visible';

              if (
                scReason ||
                hasOverflowClip ||
                pcs.display.includes('flex') ||
                pcs.display.includes('grid') ||
                pcs.position !== 'static'
              ) {
                ancestryChain.push({
                  node: describeNode(curr),
                  rect: roundRect(curr.getBoundingClientRect()),
                  display: pcs.display,
                  position: pcs.position,
                  zIndex: pcs.zIndex,
                  overflow: `${pcs.overflowX}/${pcs.overflowY}`,
                  stackingContextReason: scReason,
                });
              }
              curr = curr.parentElement;
            }

            targetForensics = {
              node: describeNode(el),
              rect: roundRect(r),
              isZeroSize: r.width === 0 || r.height === 0,
              styles: extractKeyStyles(cs),
              stackingContextReason: getStackingContextReason(cs),
              hitTest: {
                centerPoint: { x: Math.round(cx), y: Math.round(cy) },
                inViewport,
                isOccluded,
                topmostElementAtCenter: describeNode(topEl),
                topmostRect: topEl ? roundRect(topEl.getBoundingClientRect()) : null,
                topmostStyles: topEl ? extractKeyStyles(window.getComputedStyle(topEl)) : null,
              },
              ancestryChain: ancestryChain.slice(0, 10),
            };
          }
        }

        return {
          viewport: {
            width: vw,
            height: vh,
            documentScrollWidth: document.documentElement.scrollWidth,
            documentScrollHeight: document.documentElement.scrollHeight,
            hasUnintendedHorizontalScroll: document.documentElement.scrollWidth > vw,
          },
          overflowCulprits: topOverflowCulprits,
          target: targetForensics,
          visualArtifacts: {},
        };
      },
      { selector: values.selector, vw: width, vh: height }
    );

    // STEP 2: Baseline & Zero-Dependency Canvas Visual Diff (Before HUD Injection)
    if (values.baseline) {
      const baselinePath = path.resolve(values.baseline);
      await ensureDir(baselinePath);
      const cleanScreenshotBuffer = await page.screenshot({ fullPage: values.fullPage });

      if (!(await fileExists(baselinePath)) && !values.diff) {
        // Save initial baseline (Before Fix)
        await fs.writeFile(baselinePath, cleanScreenshotBuffer);
        report.visualArtifacts.baselineSaved = baselinePath;
      } else if (await fileExists(baselinePath)) {
        // Compare against existing baseline using in-browser HTML5 Canvas
        const baselineBuffer = await fs.readFile(baselinePath);
        const baselineB64 = `data:image/png;base64,${baselineBuffer.toString('base64')}`;
        const currentB64 = `data:image/png;base64,${cleanScreenshotBuffer.toString('base64')}`;

        const diffResult = await page.evaluate(
          async ({ baseSrc, currSrc }) => {
            const loadImg = (src) =>
              new Promise((res, rej) => {
                const img = new Image();
                img.onload = () => res(img);
                img.onerror = rej;
                img.src = src;
              });

            const [imgA, imgB] = await Promise.all([loadImg(baseSrc), loadImg(currSrc)]);
            const w = Math.max(imgA.width, imgB.width);
            const h = Math.max(imgA.height, imgB.height);

            const canvasA = document.createElement('canvas');
            const canvasB = document.createElement('canvas');
            const canvasDiff = document.createElement('canvas');
            canvasA.width = canvasB.width = canvasDiff.width = w;
            canvasA.height = canvasB.height = canvasDiff.height = h;

            const ctxA = canvasA.getContext('2d');
            const ctxB = canvasB.getContext('2d');
            const ctxDiff = canvasDiff.getContext('2d');

            ctxA.drawImage(imgA, 0, 0);
            ctxB.drawImage(imgB, 0, 0);

            const dataA = ctxA.getImageData(0, 0, w, h).data;
            const dataB = ctxB.getImageData(0, 0, w, h).data;
            const diffImgData = ctxDiff.createImageData(w, h);
            const out = diffImgData.data;

            let changedPixels = 0;
            let minX = w, minY = h, maxX = 0, maxY = 0;
            const threshold = 25; // Per-channel color tolerance

            for (let i = 0; i < dataA.length; i += 4) {
              const dr = Math.abs(dataA[i] - dataB[i]);
              const dg = Math.abs(dataA[i + 1] - dataB[i + 1]);
              const db = Math.abs(dataA[i + 2] - dataB[i + 2]);

              const pxIndex = i / 4;
              const x = pxIndex % w;
              const y = Math.floor(pxIndex / w);

              if (dr > threshold || dg > threshold || db > threshold) {
                changedPixels++;
                if (x < minX) minX = x;
                if (y < minY) minY = y;
                if (x > maxX) maxX = x;
                if (y > maxY) maxY = y;
                // Highlight changed pixels in vivid Magenta (#ff00ff)
                out[i] = 255;
                out[i + 1] = 0;
                out[i + 2] = 255;
                out[i + 3] = 255;
              } else {
                // Dim unchanged background in subtle grayscale for context
                const gray = Math.round(
                  0.299 * dataB[i] + 0.587 * dataB[i + 1] + 0.114 * dataB[i + 2]
                );
                out[i] = gray;
                out[i + 1] = gray;
                out[i + 2] = gray;
                out[i + 3] = 90;
              }
            }

            ctxDiff.putImageData(diffImgData, 0, 0);

            // Draw bounding box around changed region if changes exist
            if (changedPixels > 0) {
              ctxDiff.strokeStyle = '#00ffff';
              ctxDiff.lineWidth = 2;
              ctxDiff.strokeRect(minX - 2, minY - 2, maxX - minX + 4, maxY - minY + 4);
            }

            return {
              totalPixels: w * h,
              changedPixels,
              diffPercentage: Number(((changedPixels / (w * h)) * 100).toFixed(3)),
              changedBoundingBox:
                changedPixels > 0
                  ? { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
                  : null,
              diffDataUrl: canvasDiff.toDataURL('image/png'),
            };
          },
          { baseSrc: baselineB64, currSrc: currentB64 }
        );

        const diffOutPath = path.resolve(values.diff || '.forensics/diff.png');
        await ensureDir(diffOutPath);
        const base64Data = diffResult.diffDataUrl.replace(/^data:image\/png;base64,/, '');
        await fs.writeFile(diffOutPath, Buffer.from(base64Data, 'base64'));

        report.visualArtifacts.diffComparison = {
          baselineUsed: baselinePath,
          diffImagePath: diffOutPath,
          changedPixels: diffResult.changedPixels,
          diffPercentage: diffResult.diffPercentage,
          changedBoundingBox: diffResult.changedBoundingBox,
        };
      }
    }

    // STEP 3: Inject Visual Forensic HUD & Capture Annotated Screenshot
    if (values.annotate) {
      const annotatePath = path.resolve(values.annotate);
      await ensureDir(annotatePath);

      await page.evaluate((rep) => {
        const existing = document.getElementById('__dom_forensics_hud__');
        if (existing) existing.remove();

        const hud = document.createElement('div');
        hud.id = '__dom_forensics_hud__';
        Object.assign(hud.style, {
          position: 'fixed',
          top: '0',
          left: '0',
          width: '100vw',
          height: '100vh',
          pointerEvents: 'none',
          zIndex: '2147483647',
          fontFamily: 'monospace',
          fontSize: '11px',
        });

        const drawBox = (rect, color, bgAlpha, labelText, alignBottom = false) => {
          if (!rect || (rect.width === 0 && rect.height === 0)) return;
          const box = document.createElement('div');
          Object.assign(box.style, {
            position: 'fixed',
            left: `${rect.left}px`,
            top: `${rect.top}px`,
            width: `${Math.max(rect.width, 2)}px`,
            height: `${Math.max(rect.height, 2)}px`,
            border: `2px solid ${color}`,
            backgroundColor: bgAlpha,
            boxSizing: 'border-box',
          });

          const badge = document.createElement('div');
          badge.textContent = labelText;
          Object.assign(badge.style, {
            position: 'absolute',
            left: '0',
            [alignBottom ? 'bottom' : 'top']: '-18px',
            backgroundColor: color,
            color: '#ffffff',
            padding: '1px 5px',
            borderRadius: '3px',
            fontWeight: 'bold',
            whiteSpace: 'nowrap',
            boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
          });

          box.appendChild(badge);
          hud.appendChild(box);
        };

        // 1. Draw Red Boxes for Overflow Culprits
        (rep.overflowCulprits || []).forEach((item, idx) => {
          drawBox(
            item.rect,
            '#ef4444',
            'rgba(239, 68, 68, 0.14)',
            `OVERFLOW #${idx + 1}: ${item.node} (+${item.overflowRightPx}px)`
          );
        });

        // 2. Draw Cyan Box for Target & Orange Box for Occluder
        if (rep.target && rep.target.rect) {
          const t = rep.target;
          drawBox(
            t.rect,
            '#06b6d4',
            'rgba(6, 182, 212, 0.15)',
            `TARGET: ${t.node} (${t.rect.width}x${t.rect.height})`
          );

          if (t.hitTest && t.hitTest.isOccluded && t.hitTest.topmostRect) {
            drawBox(
              t.hitTest.topmostRect,
              '#f97316',
              'rgba(249, 115, 22, 0.22)',
              `OCCLUDER: ${t.hitTest.topmostElementAtCenter} (z:${t.hitTest.topmostStyles?.zIndex})`,
              true
            );

            // Draw Crosshair at blocked click center point
            const { x, y } = t.hitTest.centerPoint;
            const marker = document.createElement('div');
            Object.assign(marker.style, {
              position: 'fixed',
              left: `${x - 8}px`,
              top: `${y - 8}px`,
              width: '16px',
              height: '16px',
              borderRadius: '50%',
              border: '2px solid #f97316',
              backgroundColor: 'rgba(239, 68, 68, 0.85)',
              boxShadow: '0 0 0 2px #ffffff',
            });
            hud.appendChild(marker);
          }
        }

        document.body.appendChild(hud);
      }, report);

      await page.screenshot({ path: annotatePath, fullPage: values.fullPage });
      report.visualArtifacts.annotatedScreenshot = annotatePath;
    }

    console.log(JSON.stringify(report, null, 2));
  } catch (err) {
    console.error(JSON.stringify({ error: err.message }));
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
