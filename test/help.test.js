// The help center: the Markdown renderer, and every page, link, anchor and image in the guide.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const HELP = path.join(__dirname, '..', 'public', 'help');
const md = () => import(pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'markdown.js')).href);
// The table of contents lives in help.js, which needs a browser; read it as text instead.
const guidePages = () => [...fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'help.js'), 'utf8').matchAll(/\['([\w-]+)', '[^']+'\]/g)].map((m) => m[1]);

test('the renderer handles the Markdown the guide uses, and escapes everything else', async () => {
  const { render, slugify } = await md();
  const { html, headings } = render([
    '# Title', '', 'Some **bold**, *italic*, `code` and <kbd>Ctrl</kbd>.', '',
    '## Hot-spot & outlier analysis', '', '- one', '  - nested', '- two', '', '1. first', '2. second', '',
    '| A | B |', '| --- | --- |', '| x \\| y | [link](analysis.md#buffer) |', '',
    '> [!TIP]', '> Press it.', '', '```bash', 'node server.js <x>', '```', '', '![Alt](img/a.png)', '',
    'Text with <script>alert(1)</script> in it, and **Gi\\* bold**.',
  ].join('\n'), { link: (h) => h.replace(/\.md/, ''), image: (s) => `/help/${s}` });
  assert.deepEqual(headings.map((x) => [x.level, x.id]), [[1, 'title'], [2, 'hot-spot--outlier-analysis']]);
  assert.match(html, /<strong>bold<\/strong>, <em>italic<\/em>, <code>code<\/code> and <kbd>Ctrl<\/kbd>/);
  assert.match(html, /<ul><li>one<ul><li>nested<\/li><\/ul><\/li><li>two<\/li><\/ul>/);
  assert.match(html, /<ol><li>first<\/li><li>second<\/li><\/ol>/);
  assert.match(html, /<td>x \| y<\/td><td><a href="analysis#buffer">link<\/a><\/td>/);
  assert.match(html, /class="hp-alert is-tip"><p class="hp-alert-title">Tip<\/p><p>Press it.<\/p>/);
  assert.match(html, /<pre data-lang="bash"><code>node server.js &lt;x&gt;<\/code><\/pre>/);
  assert.match(html, /<figure><img src="\/help\/img\/a.png" alt="Alt" loading="lazy"><\/figure>/);
  assert.ok(!html.includes('<script>'), 'raw HTML is escaped');
  assert.match(html, /<strong>Gi\* bold<\/strong>/, 'backslash escapes');
  assert.equal(slugify('3D viewshed & line of sight'), '3d-viewshed--line-of-sight');
});

test('every page in the table of contents exists, and every page is listed', () => {
  const listed = guidePages();
  assert.ok(listed.length >= 20, `${listed.length} pages`);
  const files = fs.readdirSync(HELP).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, ''));
  assert.deepEqual(listed.filter((p) => !files.includes(p)), [], 'listed but missing');
  assert.deepEqual(files.filter((f) => !listed.includes(f)), [], 'files not in the table of contents');
});

test('every link, anchor and image in the guide points somewhere real', async () => {
  const { render } = await md();
  const pages = guidePages();
  const anchors = new Map(pages.map((p) => [p, new Set(render(fs.readFileSync(path.join(HELP, `${p}.md`), 'utf8')).headings.map((x) => x.id))]));
  const problems = [];
  for (const p of pages) {
    const text = fs.readFileSync(path.join(HELP, `${p}.md`), 'utf8').replace(/```[\s\S]*?```/g, '');
    for (const [, target] of text.matchAll(/(?<!!)\[[^\]]+\]\(([^)\s]+)\)/g)) {
      if (/^https?:\/\//.test(target)) continue;
      const m = /^(?:([\w-]+)\.md)?(?:#([\w-]+))?$/.exec(target);
      if (!m) { problems.push(`${p}: odd link ${target}`); continue; }
      const page = m[1] || p;
      if (!anchors.has(page)) problems.push(`${p}: links to missing page ${target}`);
      else if (m[2] && !anchors.get(page).has(m[2])) problems.push(`${p}: links to missing section ${target}`);
    }
    for (const [, src] of text.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)) {
      if (!fs.existsSync(path.join(HELP, src))) problems.push(`${p}: missing image ${src}`);
    }
  }
  assert.deepEqual(problems, []);
});

test('every analysis tool has a section in the tool reference (the tool screen links to it)', async () => {
  const { render, slugify } = await md();
  globalThis.turf ||= {};
  const { TOOLS } = await import(pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'analysis.js')).href);
  const titles = { hotspot: 'Hot-spot & outlier analysis' }; // keep in step with HELP_TITLE in workbench.js
  const ids = new Set(render(fs.readFileSync(path.join(HELP, 'analysis-tools.md'), 'utf8')).headings.map((x) => x.id));
  assert.deepEqual(Object.entries(TOOLS).filter(([id, t]) => !ids.has(slugify(titles[id] || t.name))).map(([id]) => id), []);
});
