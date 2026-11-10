// Map export: lays the live map out on a page with a title, legend, scale bar, north arrow and credits, and saves it
// as a PNG or a one-page PDF. Everything is drawn in the browser; the PDF writer below needs no library.
import { h, icon, toast } from './ui.js';

const PAPER = { letter: { name: 'US Letter', pt: [792, 612] }, a4: { name: 'A4', pt: [841.89, 595.28] }, tabloid: { name: 'Tabloid / A3', pt: [1224, 792] } };
const DPI = 150;
const FONT = 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif';

/* ---------- PDF ---------- */

/** A one-page PDF that shows a JPEG edge to edge. wPt/hPt are the page size in points (1/72 inch). */
export function pdfFromJpeg(jpeg, wPx, hPx, wPt, hPt) {
  const enc = new TextEncoder();
  const parts = [];
  const offsets = [];
  let size = 0;
  const add = (x) => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); size += b.length; };
  const obj = (n, body) => { offsets[n] = size; add(`${n} 0 obj\n${body}\nendobj\n`); };
  const content = `q ${wPt.toFixed(2)} 0 0 ${hPt.toFixed(2)} 0 0 cm /Im0 Do Q`;
  add('%PDF-1.4\n%âãÏÓ\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${wPt.toFixed(2)} ${hPt.toFixed(2)}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  offsets[4] = size;
  add(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${wPx} /Height ${hPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
  add(jpeg);
  add('\nendstream\nendobj\n');
  obj(5, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  const xref = size;
  add(`xref\n0 6\n0000000000 65535 f \n${[1, 2, 3, 4, 5].map((n) => `${String(offsets[n]).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(size);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/* ---------- drawing ---------- */

/** A round distance for a scale bar that fits in maxPx: { metres, px, label }. */
export function scaleBar(metresPerPx, maxPx) {
  const max = metresPerPx * maxPx;
  const pow = 10 ** Math.floor(Math.log10(max));
  const metres = [5, 2, 1].map((m) => m * pow).find((m) => m <= max) || pow;
  const miles = metres / 1609.344;
  const label = `${metres >= 1000 ? `${metres / 1000} km` : `${metres} m`} · ${miles >= 0.2 ? `${miles >= 10 ? Math.round(miles) : Math.round(miles * 10) / 10} mi` : `${Math.round(metres * 3.28084).toLocaleString()} ft`}`;
  return { metres, px: metres / metresPerPx, label };
}

// The map as an image. Reading the canvas only works in the same frame it was drawn, hence the render event.
const snapshot = (map) => new Promise((resolve, reject) => {
  map.once('render', () => {
    try {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('The map could not be captured'));
      img.src = map.getCanvas().toDataURL('image/png');
    } catch { reject(new Error('This map uses imagery that its server doesn\'t allow to be exported')); }
  });
  map.triggerRepaint();
});

function wrap(ctx, text, maxWidth, maxLines = 2) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width > maxWidth && line) { lines.push(line); line = w; if (lines.length === maxLines) break; } else line = next;
  }
  if (line && lines.length < maxLines) lines.push(line);
  else if (line && lines.length === maxLines) lines[maxLines - 1] = `${lines[maxLines - 1].replace(/.{2}$/, '')}…`;
  return lines;
}

function legendRows(map) {
  const rows = [];
  for (const layer of map._library.filter((l) => map._visible.includes(l.id))) {
    const info = map._legendInfo?.[layer.id];
    if (!info || info.type === 'error') continue;
    const color = layer.style?.color || '#2563eb';
    if (info.type === 'categories') { rows.push({ head: layer.name || 'Layer' }); info.entries.slice(0, 10).forEach(([label, c]) => rows.push({ swatch: c, text: String(label) })); }
    else if (info.type === 'ramp') rows.push({ head: layer.name || 'Layer' }, { ramp: [info.low, info.high], text: `${fmt(info.min)} to ${fmt(info.max)}` });
    else if (info.type === 'heat') rows.push({ head: layer.name || 'Layer' }, { ramp: info.stops.map((s) => s[1]).slice(1), text: 'Fewer to more' });
    else rows.push({ swatch: info.type === 'imagery' ? null : info.color || color, text: layer.name || 'Layer', bold: true });
    if (info.size) rows.push({ text: `Size: ${info.size.field} (${fmt(info.size.min)} to ${fmt(info.size.max)})`, note: true });
  }
  return rows;
}
const fmt = (n) => (Math.abs(n) >= 1000 ? Math.round(n).toLocaleString() : String(Math.round(n * 100) / 100));

/**
 * Draws the page and returns its canvas.
 * opts: { title, subtitle, paper, landscape, legend, scale, north, credits }
 */
export async function renderPage(map, opts = {}) {
  const paper = PAPER[opts.paper] || PAPER.letter;
  const [long, short] = paper.pt;
  const [wPt, hPt] = opts.landscape === false ? [short, long] : [long, short];
  const k = DPI / 72;
  const [W, H] = [Math.round(wPt * k), Math.round(hPt * k)];
  const shot = await snapshot(map);
  await document.fonts?.ready;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  const m = Math.round(0.4 * DPI); // page margin
  let top = m;

  if (opts.title) {
    ctx.fillStyle = '#111827';
    ctx.font = `700 ${Math.round(0.26 * DPI)}px ${FONT}`;
    ctx.textBaseline = 'top';
    for (const line of wrap(ctx, opts.title, W - 2 * m, 2)) { ctx.fillText(line, m, top); top += Math.round(0.32 * DPI); }
    if (opts.subtitle) {
      ctx.fillStyle = '#4b5563';
      ctx.font = `400 ${Math.round(0.14 * DPI)}px ${FONT}`;
      for (const line of wrap(ctx, opts.subtitle, W - 2 * m, 2)) { ctx.fillText(line, m, top); top += Math.round(0.19 * DPI); }
    }
    top += Math.round(0.1 * DPI);
  }

  const creditText = opts.credits === false ? '' : [...new Set([...(map.getContainer().querySelector('.maplibregl-ctrl-attrib-inner')?.textContent || '').split('|'),
    ...map._library.filter((l) => map._visible.includes(l.id) && l.attribution).map((l) => l.attribution.replace(/<[^>]+>/g, ''))].map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean))].join(' | ');
  const creditH = creditText ? Math.round(0.2 * DPI) : 0;
  const frame = { x: m, y: top, w: W - 2 * m, h: H - top - m - creditH };

  // The map fills the frame, cropped from its center, so the middle of the screen is the middle of the page.
  const s = Math.max(frame.w / shot.width, frame.h / shot.height);
  const [sw, sh] = [frame.w / s, frame.h / s];
  ctx.drawImage(shot, (shot.width - sw) / 2, (shot.height - sh) / 2, sw, sh, frame.x, frame.y, frame.w, frame.h);
  ctx.strokeStyle = '#111827';
  ctx.lineWidth = 2;
  ctx.strokeRect(frame.x, frame.y, frame.w, frame.h);

  const box = (x, y, w, hgt) => { ctx.fillStyle = 'rgba(255,255,255,0.93)'; ctx.fillRect(x, y, w, hgt); ctx.strokeStyle = 'rgba(17,24,39,0.35)'; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, hgt - 1); };
  const pad = Math.round(0.1 * DPI);
  const fs = Math.round(0.105 * DPI);

  if (opts.legend !== false) {
    const rows = legendRows(map);
    if (rows.length) {
      const lineH = Math.round(fs * 1.55);
      const sw2 = Math.round(fs * 1.1);
      ctx.font = `600 ${fs}px ${FONT}`;
      const maxW = Math.min(frame.w * 0.36, Math.max(...rows.map((r) => ctx.measureText(r.head || r.text || '').width + (r.swatch !== undefined || r.ramp ? sw2 * (r.ramp ? 4 : 1) + 8 : 0))) + 2 * pad);
      const hgt = rows.length * lineH + 2 * pad - 4;
      const [lx, ly] = [frame.x + pad, frame.y + frame.h - hgt - pad];
      box(lx, ly, maxW, hgt);
      ctx.textBaseline = 'middle';
      rows.forEach((r, i) => {
        const cy = ly + pad + i * lineH + lineH / 2 - 2;
        let x = lx + pad;
        if (r.ramp) {
          const g = ctx.createLinearGradient(x, 0, x + sw2 * 4, 0);
          r.ramp.forEach((c, j) => g.addColorStop(r.ramp.length === 1 ? 0 : j / (r.ramp.length - 1), c));
          ctx.fillStyle = g;
          ctx.fillRect(x, cy - sw2 / 2, sw2 * 4, sw2);
          x += sw2 * 4 + 8;
        } else if (r.swatch) { ctx.fillStyle = r.swatch; ctx.fillRect(x, cy - sw2 / 2, sw2, sw2); x += sw2 + 8; }
        ctx.fillStyle = r.note ? '#6b7280' : '#111827';
        ctx.font = `${r.head || r.bold ? 600 : 400} ${fs}px ${FONT}`;
        let text = r.head || r.text || '';
        while (text.length > 3 && ctx.measureText(text).width > lx + maxW - pad - x) text = `${text.slice(0, -2).trimEnd()}…`;
        ctx.fillText(text, x, cy);
      });
    }
  }

  if (opts.scale !== false) {
    const c = map.getCenter();
    const cssPerShotPx = map.getContainer().clientWidth / shot.width;
    const metresPerPagePx = ((40075016.686 * Math.cos((c.lat * Math.PI) / 180)) / (512 * 2 ** map.getZoom())) * cssPerShotPx / s;
    const bar = scaleBar(metresPerPagePx, frame.w * 0.22);
    ctx.font = `600 ${fs}px ${FONT}`;
    const w = Math.max(bar.px, ctx.measureText(bar.label).width) + 2 * pad;
    const hgt = fs * 2.6 + pad;
    const [bx, by] = [frame.x + frame.w - w - pad, frame.y + frame.h - hgt - pad];
    box(bx, by, w, hgt);
    ctx.fillStyle = '#111827';
    ctx.textBaseline = 'top';
    ctx.fillText(bar.label, bx + pad, by + pad * 0.6);
    const yb = by + hgt - pad * 0.9;
    ctx.fillRect(bx + pad, yb - 6, bar.px, 6);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(bx + pad + bar.px / 2, yb - 5, bar.px / 2 - 1, 4);
  }

  if (opts.north !== false) {
    const r = Math.round(0.2 * DPI);
    const [cx, cy] = [frame.x + frame.w - r - pad * 1.5, frame.y + r + pad * 1.5];
    ctx.save();
    ctx.translate(cx, cy);
    ctx.beginPath(); ctx.arc(0, 0, r + 6, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,0.93)'; ctx.fill(); ctx.strokeStyle = 'rgba(17,24,39,0.35)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.rotate((-map.getBearing() * Math.PI) / 180);
    ctx.beginPath(); ctx.moveTo(0, -r * 0.34); ctx.lineTo(r * 0.36, r * 0.82); ctx.lineTo(0, r * 0.56); ctx.closePath(); ctx.fillStyle = '#111827'; ctx.fill();
    ctx.beginPath(); ctx.moveTo(0, -r * 0.34); ctx.lineTo(-r * 0.36, r * 0.82); ctx.lineTo(0, r * 0.56); ctx.closePath(); ctx.fillStyle = '#9ca3af'; ctx.fill();
    ctx.fillStyle = '#111827';
    ctx.font = `700 ${Math.round(fs * 0.95)}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', 0, -r * 0.66);
    ctx.restore();
  }

  if (creditText) {
    ctx.fillStyle = '#6b7280';
    ctx.font = `400 ${Math.round(0.085 * DPI)}px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    let text = creditText;
    while (text.length > 10 && ctx.measureText(text).width > frame.w) text = `${text.slice(0, -4)}…`;
    ctx.fillText(text, frame.x, frame.y + frame.h + Math.round(0.07 * DPI));
  }
  return { canvas, wPt, hPt };
}

const blobOf = (canvas, type, q) => new Promise((r) => canvas.toBlob(r, type, q));
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}

/* ---------- the Export panel in the map editor ---------- */

const state = { paper: 'letter', landscape: true, legend: true, scale: true, north: true };

/** Panel contents. getDoc() returns the saved map (for its title and summary). */
export function exportPanel(map, getDoc, rerender) {
  const doc = getDoc();
  state.title ??= doc.title || '';
  state.subtitle ??= doc.summary || '';
  const check = (key, label) => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: state[key], onchange: (e) => { state[key] = e.target.checked; } }), label);
  const file = () => (state.title || doc.title || 'map').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'map';
  const run = async (kind, btn) => {
    const label = btn.textContent;
    btn.disabled = true;
    try {
      const { canvas, wPt, hPt } = await renderPage(map, state);
      if (kind === 'png') download(await blobOf(canvas, 'image/png'), `${file()}.png`);
      else {
        const jpeg = new Uint8Array(await (await blobOf(canvas, 'image/jpeg', 0.92)).arrayBuffer());
        const pdf = new Blob([pdfFromJpeg(jpeg, canvas.width, canvas.height, wPt, hPt)], { type: 'application/pdf' });
        if (kind === 'print') window.open(URL.createObjectURL(pdf), '_blank', 'noopener');
        else download(pdf, `${file()}.pdf`);
      }
      toast(kind === 'print' ? 'Opened as a PDF. Print it from there.' : 'Saved to your downloads', { tone: 'ok' });
    } catch (e) { toast(e.message, { tone: 'error', duration: 7000 }); } finally { btn.disabled = false; btn.textContent = label; }
  };
  return [
    h('h2', { class: 'me-h' }, 'Export'),
    h('p', { class: 'me-hint' }, 'Saves what the map shows now as a page with a title, legend, scale bar, north arrow and credits. Move and zoom the map to frame it first.'),
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Title'), h('input', { class: 'input', type: 'text', value: state.title, placeholder: 'No title', oninput: (e) => { state.title = e.target.value; } })),
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Subtitle'), h('input', { class: 'input', type: 'text', value: state.subtitle, placeholder: 'Optional', oninput: (e) => { state.subtitle = e.target.value; } })),
    h('div', { class: 'grid-2' },
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Paper'), h('select', { onchange: (e) => { state.paper = e.target.value; } }, Object.entries(PAPER).map(([k, p]) => h('option', { value: k, selected: state.paper === k }, p.name)))),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Direction'), h('div', { class: 'seg seg-block' }, [[true, 'Wide'], [false, 'Tall']].map(([v, l]) => h('button', { type: 'button', class: state.landscape === v ? 'is-on' : '', onclick: () => { state.landscape = v; rerender?.(); } }, l))))),
    check('legend', 'Legend'), check('scale', 'Scale bar'), check('north', 'North arrow'),
    h('div', { style: 'display:grid;gap:8px;margin-top:16px' },
      h('button', { type: 'button', class: 'btn btn-primary btn-block', onclick: (e) => run('pdf', e.currentTarget) }, icon('download', { size: 15 }), 'Download PDF'),
      h('button', { type: 'button', class: 'btn btn-block', onclick: (e) => run('png', e.currentTarget) }, icon('image', { size: 15 }), 'Download image (PNG)'),
      h('button', { type: 'button', class: 'btn btn-block', onclick: (e) => run('print', e.currentTarget) }, icon('external', { size: 15 }), 'Open to print')),
    h('p', { class: 'me-hint', style: 'margin-top:12px' }, 'Pins placed in a story aren\'t part of a saved map, so they aren\'t on the page.'),
  ];
}
