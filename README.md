# 🔬 computed-dom-forensics

**Hentikan agen AI coding Anda menebak-nebak class CSS dan Tailwind secara membabi buta.**

[![Kompatibel npx skills](https://img.shields.io/badge/npx_skills-kompatibel-black?style=flat-square)](https://skills.sh)
[![Plugin Claude Code](https://img.shields.io/badge/Claude_Code-Plugin-d97757?style=flat-square)](https://docs.anthropic.com)
[![Tanpa Dependensi Tambahan](https://img.shields.io/badge/dependensi-hanya_playwright-2ea44f?style=flat-square)](#)
[![Lisensi: MIT](https://img.shields.io/badge/Lisensi-MIT-blue.svg?style=flat-square)](LICENSE)

`computed-dom-forensics` adalah sebuah *agentic skill* sekaligus mesin telemetri CLI Playwright yang super ringan untuk **Claude Code**, **Cursor**, **Windsurf**, **OpenCode**, dan **Codex CLI**.

Ketika Anda meminta LLM memperbaiki layout mobile yang rusak, tombol yang tidak bisa diklik, atau bug `z-index`, biasanya ia menebak dari kode statis—misalnya langsung menambahkan `overflow-x-hidden` pada `<body>` atau `z-[9999]` pada sebuah komponen tanpa mengetahui geometri runtime yang sebenarnya. **`computed-dom-forensics` menegakkan Hukum Besi:** agen wajib menangkap koordinat browser nyata, stacking context, hit-test pointer, dan screenshot HUD beranotasi *sebelum* menyentuh satu baris pun kode CSS.

---

## ⚡ Mengapa Agen Membutuhkan Ini

| Bug Frontend Umum | Perilaku AI Tanpa Alat Ini ❌ | Dengan `computed-dom-forensics` ✅ |
| :--- | :--- | :--- |
| **Tombol tidak bisa diklik / Modal tumpang tindih** | Acak menaikkan `z-50` menjadi `z-[9999]` atau menghapus `relative`. | Menjalankan hit-test titik tengah `elementFromPoint(cx, cy)` dan menelusuri ancestry DOM untuk menemukan parent yang membuat jebakan stacking context `transform` / `opacity`. |
| **Scroll horizontal yang tidak diinginkan di mobile** | Menyembunyikan gejala dengan menambahkan `overflow-x-hidden` pada `body`. | Memindai semua node DOM, mengurutkan `overflowCulprits` teratas di mana `rect.right > viewport.width`, dan menunjukkan dengan tepat anak mana yang meluber `+XXpx`. |
| **Elemen sticky tidak menempel** | Mengubah `sticky top-0` menjadi `fixed` dan merusak alur layout. | Menelusuri `ancestryChain` hingga `<html>` untuk mendeteksi parent mana yang memiliki `overflow: hidden/auto` yang konflik atau tinggi yang dibatasi. |
| **Regresi visual collateral** | Memperbaiki satu tombol tapi menggeser seluruh layout halaman tanpa sadar. | Menangkap **Baseline** yang bersih (`baseline.png`) dan menghasilkan **Visual Diff** (`diff.png`) berbasis HTML5 Canvas di dalam browser yang menandai piksel berubah dengan warna Magenta (`#ff00ff`). |

---

## 📦 Instalasi

### Opsi 1: Instal via `npx skills` (Direkomendasikan untuk Cursor, Claude Code, OpenCode, Windsurf)

Instal langsung ke direktori skill proyek atau global agen Anda menggunakan skills CLI standar:

```bash
npx skills add <your-github-username>/computed-dom-forensics
```

### Opsi 2: Instal sebagai Plugin Claude Code

Di dalam sesi Claude Code, daftarkan dan instal plugin langsung:

```bash
/plugin install github:<your-github-username>/computed-dom-forensics
```

### Opsi 3: Clone Manual & Setup Lokal

```bash
git clone https://github.com/<your-github-username>/computed-dom-forensics.git
cd computed-dom-forensics
npm install
npx playwright install chromium
```

> **Catatan:** Pastikan `.forensics/` sudah ada di `.gitignore` proyek Anda agar screenshot sementara dan visual diff tidak ikut ter-commit:
> ```bash
> echo ".forensics/" >> .gitignore
> ```

---

## 🖼️ Arsitektur Multimodal HUD & Visual Diff

Tidak seperti suite visual testing berat yang memerlukan binary C++ native atau library pemroses gambar eksternal (`sharp`, `pixelmatch`, `pngjs`), `computed-dom-forensics` berjalan **100% di dalam engine Chromium bawaan Playwright**:

1. **Annotated Forensic HUD (`.forensics/annotated.png`):**
   Menyuntikkan overlay fixed tanpa gangguan (`#__dom_forensics_hud__`) tepat sebelum mengambil screenshot agar model multimodal (Claude, GPT-4o, Gemini) benar-benar bisa *melihat* geometrinya:
   * 🟥 **Kotak Merah (`OVERFLOW #n`):** Elemen yang meluber melewati tepi kanan atau kiri viewport, diberi label `+XXpx` yang presisi.
   * 🟦 **Kotak Sian (`TARGET`):** Elemen target yang diperiksa via `--selector`, diberi label dimensi `WxH` hasil komputasi.
   * 🟧 **Kotak Oranye (`OCCLUDER`) + Titik Merah:** Jika target tertutup lapisan lain (`isOccluded: true`), menandai node DOM penghalang yang persis dan koordinat klik yang terblokir `(cx, cy)`.

2. **Canvas Diff Tanpa Dependensi (`.forensics/diff.png`):**
   Membandingkan `.forensics/baseline.png` (ditangkap sebelum diedit) dengan kondisi saat ini setelah perbaikan CSS. Piksel yang tidak berubah diredupkan menjadi grayscale halus, sementara piksel yang berubah menyala dalam **Magenta Pekat (`#ff00ff`)** di dalam **Kotak Pembatas Sian**—memberi agen bukti instan bahwa perbaikannya genuglakear (surgical).

---

## 🚀 Panduan Penggunaan: Claude Code & Cursor

Setelah terinstal, skill ini aktif secara otomatis setiap kali Anda menjelaskan bug layout, overflow, perataan (alignment), atau klikabilitas.

### Menggunakan di Claude Code

1. Pastikan dev server lokal Anda berjalan (mis. `npm run dev` di `http://localhost:3000`).
2. Beri prompt ke Claude Code secara natural:
   > *"Pada viewport mobile (375x812), halaman `/checkout` scroll ke samping dan `.pay-now-btn` tidak bisa diklik. Gunakan `computed-dom-forensics` untuk mendiagnosis dan memperbaikinya."*
3. **Yang akan dilakukan Claude Code secara otomatis:**
   * Menjalankan `dom-forensics.mjs` dengan `--viewport 375x812 --selector ".pay-now-btn" --annotate .forensics/annotated-before.png --baseline .forensics/baseline.png`.
   * Menggunakan tool **`Read`** bawaan untuk memeriksa visual `.forensics/annotated-before.png` bersamaan dengan telemetri JSON.
   * Melaporkan akar masalah matematis (mis. *"`.promo-banner` meluber dari viewport 375px sebesar +42px, dan `.pay-now-btn` di (187, 760) tertutup oleh `.cookie-backdrop`"*).
   * Menerapkan perbaikan CSS/Tailwind seminimal mungkin.
   * Menjalankan ulang `dom-forensics.mjs` dengan `--diff .forensics/diff.png` dan membaca gambar diff untuk memverifikasi tidak ada kerusakan layout collateral.

### Menggunakan di Cursor (Agent Mode)

1. Jika diinstal via `npx skills add`, Cursor akan memuat `SKILL.md` secara otomatis. (Alternatifnya, symlink atau salin `skills/computed-dom-forensics/SKILL.md` ke `.cursor/rules/computed-dom-forensics.mdc`).
2. Di **Cursor Composer / Agent Mode**, sebutkan URL localhost dan deskripsi bug:
   > *"Sidebar sticky di `http://localhost:3000/docs` berhenti menempel saat di-scroll ke bawah, dan tabel kode keluar dari container flex pada 768x1024."*
3. Agen Cursor akan menjalankan perintah terminal, memeriksa output JSON dan `.forensics/annotated-before.png`, lalu memperbaiki parent container yang menyebabkan flex shrinkage atau jebakan overflow.

---

## 🛠️ Referensi CLI Standalone

Anda (atau agen Anda) juga bisa menjalankan skrip forensik langsung dari terminal mana pun:

```bash
node skills/computed-dom-forensics/scripts/dom-forensics.mjs [opsi]
```

### Opsi CLI

| Flag | Singkat | Default | Deskripsi |
| :--- | :---: | :---: | :--- |
| `--url <url>` | `-u` | *(Wajib)* | URL lengkap halaman web yang berjalan (mis. `http://localhost:3000`). |
| `--selector <css>` | `-s` | `undefined` | Selector CSS target untuk inspeksi mendalam, hit-test, dan penelusuran ancestry. |
| `--viewport <WxH>` | `-v` | `1280x800` | Dimensi viewport dalam piksel (mis. `375x812` untuk iPhone, `1440x900` untuk Desktop). |
| `--wait <ms>` | `-w` | `500` | Waktu tunggu tambahan dalam milidetik setelah load agar animasi/hydration stabil. |
| `--annotate <path>` | `-a` | `undefined` | Path output untuk screenshot beranotasi HUD (mis. `.forensics/annotated.png`). |
| `--baseline <path>` | `-b` | `undefined` | Path untuk menyimpan (jika belum ada) atau membandingkan dengan screenshot baseline yang bersih. |
| `--diff <path>` | `-d` | `undefined` | Path output gambar pixel-diff Magenta saat `--baseline` sudah ada. |
| `--fullPage` | — | `false` | Menangkap seluruh tinggi halaman yang bisa di-scroll, bukan hanya viewport. |

### Contoh Perintah Alur Kerja

**1. Sebelum Perbaikan (Tangkap Telemetri + Baseline + HUD Beranotasi):**
```bash
node skills/computed-dom-forensics/scripts/dom-forensics.mjs \
  --url "http://localhost:3000/pricing" \
  --selector "#cta-subscribe" \
  --viewport "375x812" \
  --annotate ".forensics/before-hud.png" \
  --baseline ".forensics/baseline.png"
```

**2. Setelah Perbaikan (Verifikasi Geometri + Buat Visual Diff):**
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

## 📊 Contoh Output Telemetri JSON

CLI menghasilkan JSON yang ringkas token, dirancang khusus untuk context window LLM:

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

## 🤝 Kontribusi & Lisensi

PR untuk heuristik layout tambahan (misalnya deteksi blowout track CSS Grid atau clipping font sub-piksel) sangat diterima!

Berlisensi **MIT**.
