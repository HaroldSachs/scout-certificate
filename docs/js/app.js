/* Scout Certificate of Achievement: live preview and PDF builder.
   One layout engine measures text with the same font files that go into the
   PDF, so the on-screen preview and the downloaded PDF match. */
(function () {
  'use strict';

  const { PDFDocument, StandardFonts, rgb } = PDFLib;

  // Page geometry in PDF points (letter, 612 x 792). The artwork is
  // 2551 x 3295 px at 300 dpi = 612.24 x 790.8 pt, centered vertically.
  const PAGE_W = 612, PAGE_H = 792;
  const IMG_H = 790.8, IMG_Y = (PAGE_H - IMG_H) / 2;
  // Writable area inside the border (measured off the artwork).
  const BOX = { left: 140, right: 472, top: 228, bottom: 714 };
  const CENTER_X = (BOX.left + BOX.right) / 2;
  const SIG_LINE_Y = 676;

  const COLORS = { gray: '#232528', red: '#CE1126', blue: '#003F87', green: '#3D5A3A' };

  const CDN = 'https://cdn.jsdelivr.net/fontsource/fonts/';
  const FONT_FILES = {
    garamond: 'eb-garamond@latest/latin-400-normal.ttf',
    garamondItalic: 'eb-garamond@latest/latin-400-italic.ttf',
    garamondBold: 'eb-garamond@latest/latin-700-normal.ttf',
    playfairBold: 'playfair-display@latest/latin-700-normal.ttf',
    playfairBoldItalic: 'playfair-display@latest/latin-700-italic.ttf',
    pinyon: 'pinyon-script@latest/latin-400-normal.ttf',
    fell: 'im-fell-english@latest/latin-400-normal.ttf',
    fellItalic: 'im-fell-english@latest/latin-400-italic.ttf',
  };
  // Used only if a font file cannot be downloaded.
  const FALLBACK = {
    garamond: ['TimesRoman', 'normal', 400],
    garamondItalic: ['TimesRomanItalic', 'italic', 400],
    garamondBold: ['TimesRomanBold', 'normal', 700],
    playfairBold: ['TimesRomanBold', 'normal', 700],
    playfairBoldItalic: ['TimesRomanBoldItalic', 'italic', 700],
    pinyon: ['TimesRomanItalic', 'italic', 400],
    fell: ['TimesRoman', 'normal', 400],
    fellItalic: ['TimesRomanItalic', 'italic', 400],
  };

  // Font roles per lettering style; `big` scales the display lines.
  const STYLES = {
    classic: { heading: 'playfairBold', name: 'playfairBoldItalic', body: 'garamond', bold: 'garamondBold', italic: 'garamondItalic', big: 1 },
    script: { heading: 'pinyon', name: 'pinyon', body: 'garamond', bold: 'garamondBold', italic: 'garamondItalic', big: 1.3 },
    rustic: { heading: 'fell', name: 'fellItalic', body: 'fell', bold: 'fell', italic: 'fellItalic', big: 1.05 },
  };

  // pdf-lib mis-spaces ligature glyphs, so ligatures and kerning are off in
  // both the PDF and the preview to keep them identical.
  const NO_LIGATURES = { liga: false, clig: false, dlig: false, kern: false };

  const FIELDS = ['style', 'accent', 'presenter', 'presents', 'name', 'subtitle', 'connector',
    'title', 'body', 'align', 'date', 'sig1Name', 'sig1Title', 'sig2Name', 'sig2Title'];
  const STORE_KEY = 'scoutCertificate.v1';

  const fontBytes = {};   // key -> ArrayBuffer (missing if download failed)
  let measureFonts = null; // key -> embedded pdf-lib font, used for preview layout
  let fontNote = '';

  const form = document.getElementById('cert-form');
  const canvas = document.getElementById('preview');
  const ctx = canvas.getContext('2d');
  const statusEl = document.getElementById('status');
  const downloadBtn = document.getElementById('download-btn');

  const previewImg = new Image();
  previewImg.src = 'img/certificate-preview.jpg';

  // ---------- form state ----------

  function readForm() {
    const fd = new FormData(form);
    const out = {};
    FIELDS.forEach(k => { out[k] = (fd.get(k) || '').toString(); });
    return out;
  }

  function writeForm(values) {
    FIELDS.forEach(k => {
      const v = values[k] == null ? '' : values[k];
      const els = form.elements[k];
      if (!els) return;
      if (els instanceof RadioNodeList) {
        Array.from(els).forEach(r => { r.checked = r.value === v; });
        if (!Array.from(els).some(r => r.checked)) els[0].checked = true;
      } else {
        els.value = v;
      }
    });
  }

  function todayLine() {
    const d = new Date();
    return 'Presented on ' + d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  }

  function exampleValues() {
    return {
      style: 'classic', accent: 'red', align: 'center',
      presenter: 'Troop 123\nAnytown, USA',
      presents: 'Proudly Presents',
      name: 'Jordan Rivera',
      subtitle: 'First Class Scout',
      connector: 'With This',
      title: 'Certificate of Achievement',
      body: 'In recognition of outstanding service as Senior Patrol Leader during the summer camp season. Jordan planned the troop program, led by example, and made sure every new Scout felt welcome.\n\nThank you for showing what it means to “Be Prepared.”',
      date: todayLine(),
      sig1Name: 'Pat Morgan', sig1Title: 'Scoutmaster',
      sig2Name: 'Chris Lee', sig2Title: 'Committee Chair',
    };
  }

  // ---------- fonts ----------

  async function loadFonts() {
    await Promise.all(Object.entries(FONT_FILES).map(async ([key, path]) => {
      try {
        const res = await fetch(CDN + path);
        if (!res.ok) throw new Error(res.status);
        const buf = await res.arrayBuffer();
        const face = new FontFace('cert-' + key, buf.slice(0), { featureSettings: '"liga" 0, "clig" 0, "dlig" 0, "kern" 0' });
        await face.load();
        document.fonts.add(face);
        fontBytes[key] = buf;
      } catch (err) {
        console.warn('Font download failed, using fallback for', key, err);
      }
    }));
  }

  async function embedFonts(doc) {
    doc.registerFontkit(fontkit);
    const set = {};
    for (const key of Object.keys(FONT_FILES)) {
      set[key] = fontBytes[key]
        ? await doc.embedFont(fontBytes[key], { subset: false, features: NO_LIGATURES })
        : await doc.embedFont(StandardFonts[FALLBACK[key][0]]);
    }
    return set;
  }

  function cssFont(key, size) {
    if (fontBytes[key]) return `${size}px "cert-${key}"`;
    const [, style, weight] = FALLBACK[key];
    return `${style} ${weight} ${size}px "Times New Roman", Times, serif`;
  }

  // Standard (fallback) PDF fonts only cover WinAnsi; replace anything else.
  function clean(key, text) {
    text = text.replace(/[\u0000-\u001F\u007F]/g, '');
    if (!fontBytes[key]) {
      text = text.replace(/[^\x20-\x7E\xA0-\xFF‘’“”–—…•]/g, '?');
    }
    return text;
  }

  // ---------- layout ----------

  // US English hyphenation (hyphen package, loaded as a classic script).
  // Falls back to no hyphenation if the script did not load.
  const hyphenateWord = (window.createHyphenator && window.hyphenationPatternsEnUs)
    ? window.createHyphenator(window.hyphenationPatternsEnUs, { html: false })
    : null;

  // Ways to split a word across lines, longest first part first:
  // after a hard hyphen, or at a dictionary syllable break (adds "-").
  // Capitalized words (names) and words with digits are never split.
  function breakPoints(word) {
    const out = [];
    for (let i = word.length - 2; i > 1; i--) {
      if (word[i] === '-') out.push([word.slice(0, i + 1), word.slice(i + 1)]);
    }
    if (hyphenateWord && /^[a-z]/.test(word) && !/\d/.test(word) && !word.includes('-')) {
      const parts = hyphenateWord(word).split(String.fromCharCode(0xAD));
      for (let k = parts.length - 1; k > 0; k--) {
        out.push([parts.slice(0, k).join('') + '-', parts.slice(k).join('')]);
      }
    }
    return out;
  }

  function wrap(text, key, size, maxW, measure, hyphenate) {
    const words = text.split(/\s+/).filter(Boolean);
    const lines = [];
    let cur = [];
    const width = ws => measure(ws.join(' '), key, size);
    for (let n = 0; n < words.length; n++) {
      const w = words[n];
      if (!cur.length || width(cur.concat(w)) <= maxW) { cur.push(w); continue; }
      if (hyphenate) {
        const fit = breakPoints(w).find(([head]) => width(cur.concat(head)) <= maxW);
        if (fit) {
          lines.push(cur.concat(fit[0]));
          cur = [];
          words.splice(n + 1, 0, fit[1]); // the rest of the word starts the next line
          continue;
        }
      }
      lines.push(cur);
      cur = [w];
    }
    if (cur.length) lines.push(cur);
    return lines;
  }

  // Returns { ops: [{text,x,y,size,font,color}], rules: [{x1,x2,y}] } with
  // y measured from the top of the page (baseline).
  function layout(f, measure) {
    const st = STYLES[f.style] || STYLES.classic;
    const ink = COLORS.gray;
    const accent = COLORS[f.accent] || COLORS.red;
    const ops = [], rules = [];
    const T = (key, s) => clean(key, s.trim());

    // Signatures sit at a fixed height near the bottom.
    let contentBottom = BOX.bottom;
    const signers = [[f.sig1Name, f.sig1Title], [f.sig2Name, f.sig2Title]]
      .map(([n, t]) => [n.trim(), t.trim()])
      .filter(([n, t]) => n || t);
    if (signers.length) {
      contentBottom = SIG_LINE_Y - 30;
      const cols = signers.length === 1 ? [CENTER_X] : [BOX.left + 78, BOX.right - 78];
      const lineW = signers.length === 1 ? 190 : 150;
      signers.forEach(([n, t], i) => {
        const cx = cols[i];
        rules.push({ x1: cx - lineW / 2, x2: cx + lineW / 2, y: SIG_LINE_Y });
        let y = SIG_LINE_Y + 14;
        [[n, st.body, 12], [t, st.italic, 11]].forEach(([txt, key, size]) => {
          if (!txt) return;
          txt = T(key, txt);
          let w = measure(txt, key, size);
          if (w > lineW + 16) { size *= (lineW + 16) / w; w = measure(txt, key, size); }
          ops.push({ text: txt, x: cx - w / 2, y, size, font: key, color: ink });
          y += 13;
        });
      });
    }

    // Main blocks, top to bottom.
    const blocks = [];
    const add = (text, font, size, color, gap, opts = {}) => {
      if (!text || !text.trim()) return;
      blocks.push(Object.assign({ text, font, size, color, gap, lh: 1.2, para: false }, opts));
    };
    add(f.presenter, st.bold, 16, ink, 0);
    add(f.presents, st.italic, 14, ink, 4);
    add(f.name, st.name, 32 * st.big, accent, 16);
    add(f.subtitle, st.name, 19 * st.big, accent, 2);
    add(f.connector, st.italic, 14, ink, 14);
    add(f.title, st.heading, 24 * st.big, accent, 8);
    add(f.body, st.body, 12.5, ink, 18, { para: true, lh: 1.38 });
    add(f.date, st.italic, 12.5, ink, 16);
    if (blocks.length) blocks[0].gap = 0;

    const maxW = BOX.right - BOX.left;
    const avail = contentBottom - BOX.top;

    // Break every block into lines at a given scale; shrink until it fits.
    function build(scale) {
      let height = 0;
      const out = blocks.map(b => {
        const size = b.size * scale;
        const lines = []; // {words, last, blank}
        b.text.split('\n').forEach(raw => {
          const txt = T(b.font, raw);
          if (!txt) { if (b.para) lines.push({ blank: true }); return; }
          const wl = wrap(txt, b.font, size, maxW, measure, b.para && f.align === 'justify');
          wl.forEach((words, i) => lines.push({ words, last: i === wl.length - 1 }));
        });
        const gap = b.gap * scale;
        let h = gap;
        lines.forEach(l => { h += l.blank ? size * 0.6 : size * b.lh; });
        height += h;
        return { b, size, lines, gap };
      });
      return { out, height };
    }

    let scale = 1, built = build(1);
    while (built.height > avail && scale > 0.45) {
      scale -= 0.025;
      built = build(scale);
    }

    let y = BOX.top + Math.max(0, (avail - built.height) / 2);
    built.out.forEach(({ b, size, lines, gap }) => {
      y += gap;
      lines.forEach(l => {
        if (l.blank) { y += size * 0.6; return; }
        const lineH = size * b.lh;
        const base = y + size * (b.lh - 1) / 2 + size * 0.82;
        const widths = l.words.map(w => measure(w, b.font, size));
        const textW = measure(l.words.join(' '), b.font, size);
        const justify = b.para && f.align !== 'center' && !l.last && l.words.length > 1;
        if (justify) {
          const space = (maxW - widths.reduce((a, c) => a + c, 0)) / (l.words.length - 1);
          let x = BOX.left;
          l.words.forEach((w, i) => {
            ops.push({ text: w, x, y: base, size, font: b.font, color: b.color });
            x += widths[i] + space;
          });
        } else {
          const x = b.para && f.align !== 'center' ? BOX.left : CENTER_X - textW / 2;
          ops.push({ text: l.words.join(' '), x, y: base, size, font: b.font, color: b.color });
        }
        y += lineH;
      });
    });

    return { ops, rules, shrunk: scale < 1 };
  }

  // ---------- preview ----------

  function measureWith(fonts) {
    return (text, key, size) => fonts[key].widthOfTextAtSize(text, size);
  }

  let pending = 0;
  function schedulePreview() {
    cancelAnimationFrame(pending);
    pending = requestAnimationFrame(drawPreview);
  }

  function drawPreview() {
    const f = readForm();
    try { localStorage.setItem(STORE_KEY, JSON.stringify(f)); } catch (e) { /* storage blocked */ }

    const k = canvas.width / PAGE_W;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(k, 0, 0, k, 0, 0);
    if (previewImg.complete && previewImg.naturalWidth) {
      ctx.drawImage(previewImg, 0, IMG_Y, PAGE_W, IMG_H);
    }
    if (!measureFonts) return;

    const { ops, rules, shrunk } = layout(f, measureWith(measureFonts));
    if ('fontKerning' in ctx) ctx.fontKerning = 'none'; // pdf-lib does not kern
    ctx.textBaseline = 'alphabetic';
    ops.forEach(o => {
      ctx.font = cssFont(o.font, o.size);
      ctx.fillStyle = o.color;
      ctx.fillText(o.text, o.x, o.y);
    });
    ctx.strokeStyle = COLORS.gray;
    ctx.lineWidth = 0.7;
    rules.forEach(r => { ctx.beginPath(); ctx.moveTo(r.x1, r.y); ctx.lineTo(r.x2, r.y); ctx.stroke(); });

    setStatus(shrunk ? 'Long text: lettering was made smaller to fit. Shorten the citation for larger type.' : fontNote);
  }

  function setStatus(msg, isError) {
    statusEl.textContent = msg;
    statusEl.classList.toggle('error', !!isError);
  }

  // ---------- PDF ----------

  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
  }

  async function buildPdf() {
    const f = readForm();
    const doc = await PDFDocument.create();
    doc.setTitle(f.title.trim() || 'Certificate of Achievement');
    doc.setSubject(f.name.trim());
    doc.setCreator('Scout Certificate of Achievement');
    doc.setProducer('pdf-lib');

    const imgBytes = await fetch('img/certificate-border.jpg').then(r => {
      if (!r.ok) throw new Error('Could not load the certificate artwork.');
      return r.arrayBuffer();
    });
    const img = await doc.embedJpg(imgBytes);
    const fonts = await embedFonts(doc);
    const page = doc.addPage([PAGE_W, PAGE_H]);
    page.drawImage(img, { x: 0, y: IMG_Y, width: PAGE_W, height: IMG_H });

    const { ops, rules } = layout(f, measureWith(fonts));
    ops.forEach(o => page.drawText(o.text, {
      x: o.x, y: PAGE_H - o.y, size: o.size, font: fonts[o.font], color: hexToRgb(o.color),
    }));
    rules.forEach(r => page.drawLine({
      start: { x: r.x1, y: PAGE_H - r.y }, end: { x: r.x2, y: PAGE_H - r.y },
      thickness: 0.7, color: hexToRgb(COLORS.gray),
    }));
    return { bytes: await doc.save(), name: f.name.trim() };
  }

  async function download() {
    downloadBtn.disabled = true;
    setStatus('Building your PDF…');
    try {
      const { bytes, name } = await buildPdf();
      const blob = new Blob([bytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const safe = name.replace(/[\\/:*?"<>|]+/g, '').trim();
      a.href = url;
      a.download = safe ? `Certificate - ${safe}.pdf` : 'Certificate of Achievement.pdf';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      setStatus('PDF downloaded. Print at 100% (actual size) on letter paper.');
      // Anonymous download count (GoatCounter). Sends only the lettering style, never form text.
      const style = readForm().style;
      if (window.goatcounter && window.goatcounter.count) {
        window.goatcounter.count({ path: 'download-pdf-' + style, title: 'PDF downloaded (' + style + ')', event: true });
      }
    } catch (err) {
      console.error(err);
      setStatus('Sorry, the PDF could not be built: ' + err.message, true);
    } finally {
      downloadBtn.disabled = false;
    }
  }

  // ---------- wiring ----------

  form.addEventListener('input', schedulePreview);
  form.addEventListener('change', schedulePreview);
  previewImg.addEventListener('load', schedulePreview);
  downloadBtn.addEventListener('click', download);
  document.getElementById('example-btn').addEventListener('click', () => {
    writeForm(exampleValues());
    schedulePreview();
  });
  document.getElementById('clear-btn').addEventListener('click', () => {
    writeForm({ style: readForm().style, accent: readForm().accent, align: 'center', date: todayLine() });
    try { localStorage.removeItem(STORE_KEY); } catch (e) { /* ignore */ }
    schedulePreview();
  });

  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch (e) { /* ignore */ }
  writeForm(Object.assign(saved || exampleValues(), { date: todayLine() })); // date is always the day of the visit
  schedulePreview();

  (async () => {
    await loadFonts();
    const doc = await PDFDocument.create();
    measureFonts = await embedFonts(doc);
    downloadBtn.disabled = false;
    const missing = Object.keys(FONT_FILES).filter(k => !fontBytes[k]);
    fontNote = missing.length ? 'Some lettering could not load; a standard font is being used instead.' : '';
    schedulePreview();
  })().catch(err => {
    console.error(err);
    setStatus('The certificate maker could not start: ' + err.message, true);
  });
})();
