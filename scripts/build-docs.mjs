// Builds the documentation website (docs/index.html) from docs/GUIDE.md. Run: npm run docs
import { readFileSync, writeFileSync } from 'node:fs';
import { marked } from 'marked';

const REPO = 'https://github.com/my-live-is-a-lie/strings.xml-translator';
const SITE = 'https://my-live-is-a-lie.github.io/strings.xml-Translator/';
const md = readFileSync('docs/GUIDE.md', 'utf8');
const body = md.slice(md.indexOf('## 1. What it is'));
const css = readFileSync('scripts/docs.css', 'utf8');
const client = readFileSync('scripts/docs-client.js', 'utf8');

const slug = (t) =>
  t
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s/g, '-');

// ---- image size (PNG / JPEG header) so figures get the right frame and no layout shift
function imageSize(path) {
  const b = readFileSync('docs/' + path);
  if (b[0] === 0x89 && b[1] === 0x50) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
    i += 2 + b.readUInt16BE(i + 2);
  }
  throw new Error('unknown image ' + path);
}
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const sections = [];
let curSection = null;
const renderer = new marked.Renderer();
renderer.heading = (text, level) => {
  const id = slug(text.replace(/&[a-z]+;/g, ''));
  if (level === 2) {
    curSection = { id, title: text.replace(/^\d+\.\s*/, ''), n: text.match(/^(\d+)\./)?.[1] ?? '', subs: [] };
    sections.push(curSection);
  } else if (level === 3 && curSection) curSection.subs.push({ id, title: text });
  const anchor = level <= 3 ? `<a class="anchor" href="#${id}" aria-label="Link to this section">#</a>` : '';
  return `<h${level} id="${id}">${text}${anchor}</h${level}>\n`;
};
renderer.blockquote = (quote) => `<aside class="callout">${quote}</aside>\n`;
renderer.table = (header, bodyHtml) => `<div class="table-wrap"><table><thead>${header}</thead><tbody>${bodyHtml}</tbody></table></div>\n`;
renderer.hr = () => '<hr class="sep" />\n';
renderer.image = (href, title, text) => {
  const { w, h } = imageSize(href);
  const r = h / w;
  const kind = r > 1.5 ? 'phone' : r < 0.6 ? 'strip' : 'card-fig';
  const img = `<img src="${href}" alt="${esc(text)}" width="${w}" height="${h}" loading="lazy" data-zoom />`;
  const cap = title ? `<figcaption>${esc(title)}</figcaption>` : '';
  const inner =
    kind === 'phone'
      ? `<div class="frame"><div class="scroller">${img}</div><span class="hint">Scroll ↕ · tap to zoom</span></div>`
      : img;
  return `<figure class="shot ${kind} reveal">${inner}${cap}</figure>`;
};
renderer.paragraph = (text) => (/^(<figure[\s\S]*?<\/figure>\s*)+$/.test(text.trim()) ? `<div class="figs">${text}</div>\n` : `<p>${text}</p>\n`);
renderer.html = (h) => {
  if (h.includes('demo:double-space')) {
    return `<div class="demo" id="demo-ds">
  <div class="demo-h"><b>Try it</b><span>Open a quote or bracket, type something, then press <kbd>Space</kbd> twice.</span></div>
  <div class="chips">
    <button type="button" data-t="He said &quot;hello">He said "hello</button>
    <button type="button" data-t="Call support (Mon–Fri">Call support (Mon–Fri</button>
    <button type="button" data-t="قال “مرحبا">قال “مرحبا</button>
    <button type="button" data-t="Hello, %1$s! (you have %2$d tasks">Hello, %1$s! (you have %2$d tasks</button>
  </div>
  <textarea rows="3" spellcheck="false" dir="auto" placeholder="Type here…  e.g.  She said &quot;thanks"></textarea>
  <div class="demo-foot"><label><input type="checkbox" checked /> Auto-correct on</label><span class="status" aria-live="polite"></span></div>
</div>\n`;
  }
  return h;
};

let html = marked.parse(body, { renderer, gfm: true });
html = html.replace(/<h2 id="(\d+)-([^"]+)">/g, '<h2 id="$1-$2" data-section>');

// wrap every top-level section and add previous/next links
const chunks = html.split(/(?=<h2 id=)/).filter((c) => c.trim());
if (chunks.length !== sections.length) throw new Error(`sections mismatch ${chunks.length} vs ${sections.length}`);
html = chunks
  .map((c) => `<section class="sec">${c}</section>`)
  .join('\n');

const nav = sections
  .map(
    (s) =>
      `<div class="grp" data-grp="${s.id}"><a href="#${s.id}" data-nav="${s.id}"><span class="num">${s.n}</span>${s.title}</a>` +
      (s.subs.length ? `<div class="subs">${s.subs.map((u) => `<a href="#${u.id}" data-nav="${u.id}">${u.title}</a>`).join('')}</div>` : '') +
      `</div>`,
  )
  .join('\n');

// ---- feature gallery (every card links to a real section)
const gallery = [
  { t: 'Smart auto-correct', d: 'Restores broken placeholders and tags and matches the source punctuation.', img: 'img/save-guard.png', href: '#auto-correct' },
  { t: 'Double-space closing', d: 'Press Space twice to close the nearest open quote or bracket.', img: 'img/double-space-after.png', href: '#double-space-closes-open-symbols', fit: 'contain' },
  { t: 'Quality checks', d: 'Counters and a list for placeholder and HTML-tag problems.', img: 'img/qa-checks.png', href: '#6-quality-checks' },
  { t: 'Quick-insert bars', d: 'Punctuation and direction marks that learn your habits.', img: 'img/quick-insert.png', href: '#quick-insert-bars', fit: 'contain' },
  { t: 'Translation providers', d: 'Gemini, OpenAI, DeepL, Azure, Yandex and more with your own key.', img: 'img/providers.png', href: '#providers' },
  { t: 'Powerful filters', d: 'Combine status and AI / manual origin to review what matters.', img: 'img/filters.png', href: '#filters', fit: 'contain' },
  { t: 'Strings list', d: 'Collapsed one-line rows that expand on tap.', img: 'img/row-expanded.png', href: '#strings-list-drawer' },
  { t: 'Table view', d: 'Every string as an editable row, even in huge files.', img: 'img/table-view.png', href: '#table-view' },
  { t: 'Multi-language ZIP', d: 'Translate several languages in one run and export a ZIP.', img: 'screenshots/multi-language-zip.jpg', href: '#multi-language-zip' },
  { t: 'Projects', d: 'Switch files without losing work; everything stays on your device.', img: 'screenshots/projects.png', href: '#10-projects-and-saved-work' },
  { t: 'Clean export', d: 'A production-ready strings.xml that keeps your file structure.', img: 'img/export.png', href: '#11-exporting' },
  { t: 'Your own UI language', d: 'Download, translate and upload the app text to add a language.', img: 'img/add-language.png', href: '#13-interface-languages-and-themes' },
];
const ids = new Set([...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]));
for (const g of gallery) if (!ids.has(g.href.slice(1))) throw new Error('gallery link has no target: ' + g.href);
const cards = gallery
  .map(
    (g) =>
      `<a class="card reveal" href="${g.href}"><div class="thumb${g.fit === 'contain' ? ' contain' : ''}"><img src="${g.img}" alt="" loading="lazy" /></div><div class="t"><b>${g.t}</b><span>${g.d}</span><i>Read more →</i></div></a>`,
  )
  .join('\n');

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>XML Translator – Android strings.xml Translator App &amp; Guide</title>
<meta name="description" content="XML Translator is an Android app for translating strings.xml localization files on your phone. Keeps placeholders and plurals intact, adds quality checks, and exports values-xx folders. Guide and download." />
<meta name="keywords" content="strings.xml translator, Android strings.xml translation, translate strings.xml, Android localization app, values-xx folder, strings.xml editor, translate Android app" />
<meta name="robots" content="index, follow, max-image-preview:large" />
<link rel="canonical" href="${SITE}" />
<meta name="theme-color" content="#1eb996" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="XML Translator" />
<meta property="og:title" content="XML Translator – Android strings.xml Translator App" />
<meta property="og:description" content="Translate Android strings.xml localization files on your phone, with placeholder protection and quality checks." />
<meta property="og:image" content="${SITE}screenshots/editor.jpg" />
<meta property="og:image:alt" content="XML Translator editing an Android strings.xml file" />
<meta property="og:url" content="${SITE}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="XML Translator – Android strings.xml Translator App" />
<meta name="twitter:description" content="Translate Android strings.xml localization files on your phone, with placeholder protection and quality checks." />
<meta name="twitter:image" content="${SITE}screenshots/editor.jpg" />
<script type="application/ld+json">${JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'XML Translator',
  alternateName: 'strings.xml Translator',
  description: 'An Android app for translating strings.xml localization files, with placeholder protection, quality checks and export to values-xx folders.',
  applicationCategory: 'DeveloperApplication',
  operatingSystem: 'Android',
  url: SITE,
  downloadUrl: REPO + '/releases/latest',
  image: SITE + 'screenshots/editor.jpg',
  license: 'https://www.gnu.org/licenses/gpl-3.0.html',
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
})}</script>
<link rel="icon" href="icon.svg" type="image/svg+xml" />
<script>try{var t=localStorage.getItem('docs-theme');if(t)document.documentElement.dataset.theme=t;}catch(e){}</script>
<style>
${css}</style>
</head>
<body>
<div id="progress"></div>
<header class="top">
  <button class="btn icon-btn menu" id="menu" aria-label="Toggle navigation"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg></button>
  <a class="brand" href="#top"><img src="icon.svg" alt="" />XML Translator <span style="color:var(--muted);font-weight:500">Docs</span></a>
  <span class="spacer"></span>
  <a class="btn" href="${REPO}" target="_blank" rel="noopener"><span class="label">GitHub</span><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg></a>
  <button class="btn icon-btn" id="theme" aria-label="Toggle theme"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 3v18" /><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/></svg></button>
</header>
<div class="layout" id="top">
  <aside class="side">
    <div class="searchbox">
      <input class="search" id="q" type="search" placeholder="Search the guide…" aria-label="Search the guide" autocomplete="off" />
      <kbd>/</kbd>
    </div>
    <div id="results" aria-live="polite"></div>
    <nav id="nav">
${nav}
    </nav>
  </aside>
  <main>
    <section class="hero">
      <h1>Translate <span>strings.xml</span><br />faster and safer</h1>
      <p class="lead">XML Translator is an Android app for translating the <code>strings.xml</code> localization files of Android apps. Load your base file, translate on your phone, and export a clean <code>strings.xml</code> or one <code>values-xx</code> folder per language.</p>
      <div class="row">
        <a class="btn primary" href="${REPO}/releases/latest" target="_blank" rel="noopener">Download the app</a>
        <a class="btn primary try" href="demo/" target="_blank" rel="noopener">Try it <svg class="chev" viewBox="7.5 4.5 8.5 15" width="7.8" height="13.75" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg></a>
        <a class="btn" href="#2-quick-start">Quick start</a>
        <a class="btn" href="${REPO}" target="_blank" rel="noopener">Source code</a>
      </div>
      <div class="shots">
        <img src="screenshots/editor.jpg" alt="Translation editor" data-zoom />
        <img src="screenshots/strings-list.jpg" alt="Strings list with QA checks" data-zoom />
        <img src="screenshots/table.jpg" alt="Table view" data-zoom />
        <img src="screenshots/providers.png" alt="Translation providers" data-zoom />
        <img src="screenshots/multi-language-zip.jpg" alt="Multi-language ZIP" data-zoom />
      </div>
    </section>
    <div class="gal-h"><h2>Features at a glance</h2><span>Tap a card to jump to its section</span></div>
    <div class="gallery">
${cards}
    </div>
    <article id="content">
${html}
      <div class="foot">Released under the <a href="${REPO}/blob/main/LICENSE">GNU GPL v3</a>. Found a mistake? <a href="${REPO}/edit/main/docs/GUIDE.md">Edit this page</a>.</div>
    </article>
  </main>
</div>
<div id="lb" role="dialog" aria-modal="true" aria-label="Image viewer" tabindex="-1"><button class="x" aria-label="Close">×</button><div class="stage"><button class="p" aria-label="Previous image">‹</button><img alt="" /><button class="n" aria-label="Next image">›</button></div><div class="cap"></div><div class="cnt"></div></div>
<div id="toast" role="status"></div>
<button id="totop" aria-label="Back to top"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg></button>
<script>
${client}</script>
</body>
</html>
`;
writeFileSync('docs/index.html', page);
writeFileSync('docs/.nojekyll', '');
writeFileSync('docs/robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${SITE}sitemap.xml\n`);
writeFileSync(
  'docs/sitemap.xml',
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${SITE}</loc><changefreq>monthly</changefreq></url>\n</urlset>\n`,
);
console.log('docs/index.html', page.length, 'bytes,', sections.length, 'sections,', gallery.length, 'cards');
