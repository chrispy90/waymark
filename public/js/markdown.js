// A small Markdown renderer for the help pages. It covers what the guide uses, in the same flavor GitHub renders, so the
// pages read the same in the app and in the repository: headings, paragraphs, lists (nested), tables, fenced code,
// quotes and GitHub alerts (> [!NOTE], > [!TIP], > [!IMPORTANT], > [!WARNING]), images, links, **bold**, *italic*,
// `code` and <kbd>keys</kbd>. All text is escaped; no other HTML passes through. No DOM here, so it can be tested in Node.

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** The anchor id GitHub gives a heading, so links like page.md#some-heading work in both places. */
export function slugify(text) {
  return String(text).trim().toLowerCase()
    .replace(/<[^>]+>/g, '').replace(/[`*_~]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s/g, '-');
}

/**
 * opts.link(href) → href: rewrites link targets (the help page turns "analysis.md#buffer" into "/help/analysis#buffer").
 * opts.image(src) → src: rewrites image sources.
 */
function inline(text, opts) {
  const codes = [];
  const literals = []; // backslash escapes, such as \* for a plain asterisk
  let s = String(text).replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; })
    .replace(/\\([\\`*_{}[\]()#+\-.!|<>~])/g, (_, c) => { literals.push(c); return `\u0001${literals.length - 1}\u0001`; });
  s = esc(s);
  s = s.replace(/&lt;kbd&gt;(.+?)&lt;\/kbd&gt;/g, '<kbd>$1</kbd>');
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, src) => `<img src="${esc(opts.image ? opts.image(src) : src)}" alt="${alt}" loading="lazy">`);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => {
    const target = opts.link ? opts.link(href.replace(/&amp;/g, '&')) : href;
    const external = /^https?:\/\//i.test(target);
    return `<a href="${esc(target)}"${external ? ' target="_blank" rel="noopener"' : ''}>${label}</a>`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[^\w*])\*([^*\s][^*]*)\*(?!\w)/g, '$1<em>$2</em>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[+i])}</code>`).replace(/\u0001(\d+)\u0001/g, (_, i) => esc(literals[+i]));
}

const ALERTS = { NOTE: 'Note', TIP: 'Tip', IMPORTANT: 'Important', WARNING: 'Warning', CAUTION: 'Caution' };

/** Renders Markdown. Returns { html, headings: [{ level, text, id }] }. */
export function render(md, opts = {}) {
  const lines = String(md).replace(/\r\n?/g, '\n').split('\n');
  const headings = [];
  const used = new Map();
  const out = [];
  let i = 0;

  const isBlockStart = (l) => /^(#{1,4}\s|```|>|\s*([-*]|\d+\.)\s|\|.*\|\s*$|---+\s*$)/.test(l);

  function list(baseIndent) {
    const ordered = /^\s*\d+\.\s/.test(lines[i]);
    const items = [];
    while (i < lines.length) {
      const m = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(lines[i]);
      if (!m || m[1].length < baseIndent) break;
      if (m[1].length === baseIndent && /\d/.test(m[2]) !== ordered) break; // a numbered list right after a bulleted one starts a new list
      if (m[1].length > baseIndent) { // a nested list belongs to the item above it
        if (items.length) items[items.length - 1].sub += list(m[1].length);
        else i++;
        continue;
      }
      i++;
      let text = m[3];
      while (i < lines.length && lines[i].trim() && !/^\s*([-*]|\d+\.)\s/.test(lines[i]) && /^\s{2,}/.test(lines[i])) text += ` ${lines[i++].trim()}`;
      items.push({ text, sub: '' });
      if (i < lines.length && !lines[i].trim() && /^\s*([-*]|\d+\.)\s/.test(lines[i + 1] || '')) {
        const next = /^(\s*)/.exec(lines[i + 1])[1].length;
        if (next >= baseIndent) i++; // a blank line between items of one list
      }
    }
    const tag = ordered ? 'ol' : 'ul';
    return `<${tag}>${items.map((it) => `<li>${inline(it.text, opts)}${it.sub}</li>`).join('')}</${tag}>`;
  }

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    const h = /^(#{1,4})\s+(.*?)\s*(?:\{#([\w-]+)\})?\s*$/.exec(line);
    if (h) {
      const level = h[1].length;
      const text = h[2];
      let id = h[3] || slugify(text);
      const n = used.get(id) || 0;
      used.set(id, n + 1);
      if (n) id = `${id}-${n}`;
      headings.push({ level, text: text.replace(/[`*]/g, ''), id });
      out.push(`<h${level} id="${esc(id)}">${inline(text, opts)}${level > 1 ? `<a class="hp-anchor" href="#${esc(id)}" aria-label="Link to this section">#</a>` : ''}</h${level}>`);
      i++;
      continue;
    }

    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const code = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) code.push(lines[i++]);
      i++;
      out.push(`<pre${lang ? ` data-lang="${esc(lang)}"` : ''}><code>${esc(code.join('\n'))}</code></pre>`);
      continue;
    }

    if (/^---+\s*$/.test(line)) { out.push('<hr>'); i++; continue; }

    if (line.startsWith('>')) {
      const body = [];
      while (i < lines.length && lines[i].startsWith('>')) body.push(lines[i++].replace(/^>\s?/, ''));
      const alert = /^\[!(\w+)\]\s*$/.exec(body[0] || '');
      if (alert && ALERTS[alert[1].toUpperCase()]) {
        const kind = alert[1].toUpperCase();
        out.push(`<div class="hp-alert is-${kind.toLowerCase()}"><p class="hp-alert-title">${ALERTS[kind]}</p>${render(body.slice(1).join('\n'), opts).html}</div>`);
      } else out.push(`<blockquote>${render(body.join('\n'), opts).html}</blockquote>`);
      continue;
    }

    if (/^\s*([-*]|\d+\.)\s/.test(line)) { out.push(list(/^(\s*)/.exec(line)[1].length)); continue; }

    if (/^\|.*\|\s*$/.test(line) && /^\|?\s*:?-{2,}/.test(lines[i + 1] || '')) {
      const cells = (l) => l.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) rows.push(cells(lines[i++]));
      const thead = head.some(Boolean) ? `<thead><tr>${head.map((c) => `<th>${inline(c, opts)}</th>`).join('')}</tr></thead>` : ''; // a header row of empty cells means no header
      out.push(`<div class="hp-table"><table>${thead}<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c, opts)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }

    const para = [line.trim()];
    i++;
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) para.push(lines[i++].trim());
    const text = para.join(' ');
    const lone = /^!\[[^\]]*\]\([^)]+\)$/.test(text);
    out.push(lone ? `<figure>${inline(text, opts)}</figure>` : `<p>${inline(text, opts)}</p>`);
  }
  return { html: out.join('\n'), headings };
}

/** Plain text of Markdown, for search. */
export const plainText = (md) => String(md).replace(/```[\s\S]*?```/g, ' ').replace(/^\s*\|?[\s:|-]*-{3,}[\s:|-]*$/gm, ' ').replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  .replace(/<\/?kbd>/g, '').replace(/[#>*`|]|\[!\w+\]/g, ' ').replace(/\s+/g, ' ').trim();
