// Builds the documentation website (docs/index.html) from docs/GUIDE.md. Run: npm run docs
import { readFileSync, writeFileSync } from 'node:fs';
import { marked } from 'marked';

const md = readFileSync('docs/GUIDE.md', 'utf8');
const body = md.slice(md.indexOf('## 1. What it is'));

const slug = (t) =>
  t
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s/g, '-');

const sections = [];
const renderer = new marked.Renderer();
renderer.heading = (text, level) => {
  const id = slug(text.replace(/&[a-z]+;/g, ''));
  if (level === 2) sections.push({ id, title: text.replace(/^\d+\.\s*/, ''), n: text.match(/^(\d+)\./)?.[1] ?? '' });
  const anchor = level <= 3 ? `<a class="anchor" href="#${id}" aria-label="Link to this section">#</a>` : '';
  return `<h${level} id="${id}">${text}${anchor}</h${level}>\n`;
};
renderer.blockquote = (quote) => `<aside class="callout">${quote}</aside>\n`;
renderer.table = (header, bodyHtml) => `<div class="table-wrap"><table><thead>${header}</thead><tbody>${bodyHtml}</tbody></table></div>\n`;
renderer.hr = () => '<hr class="sep" />\n';

// the "---" right after the contents list only separates the header from the content
let html = marked.parse(body, { renderer, gfm: true });
html = html.replace(/<h2 id="(\d+)-([^"]+)">/g, '<h2 id="$1-$2" data-section>');

const nav = sections
  .map((s) => `<a href="#${s.id}" data-nav="${s.id}"><span class="num">${s.n}</span>${s.title}</a>`)
  .join('\n');

const REPO = 'https://github.com/my-live-is-a-lie/strings.xml-translator';
const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>XML Translator — Documentation</title>
<meta name="description" content="Guide to XML Translator: translate Android strings.xml files with machine translation, quality checks and smart typing helpers." />
<meta name="theme-color" content="#1eb996" />
<link rel="icon" href="icon.svg" type="image/svg+xml" />
<script>try{var t=localStorage.getItem('docs-theme');if(t)document.documentElement.dataset.theme=t;}catch(e){}</script>
<style>
:root{--bg:#ffffff;--bg2:#f5f8f8;--panel:#ffffff;--text:#16202a;--muted:#5b6b78;--line:#e3eaee;--brand:#1eb996;--brand-ink:#0b7a64;--code:#eef3f5;--shadow:0 1px 2px rgba(16,24,40,.06),0 8px 24px rgba(16,24,40,.06)}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#0d1117;--bg2:#131a22;--panel:#141b24;--text:#e6edf3;--muted:#94a3b0;--line:#222c37;--brand-ink:#35d3b0;--code:#1a232e;--shadow:0 1px 2px rgba(0,0,0,.4),0 8px 24px rgba(0,0,0,.35)}}
:root[data-theme=dark]{--bg:#0d1117;--bg2:#131a22;--panel:#141b24;--text:#e6edf3;--muted:#94a3b0;--line:#222c37;--brand-ink:#35d3b0;--code:#1a232e;--shadow:0 1px 2px rgba(0,0,0,.4),0 8px 24px rgba(0,0,0,.35)}
*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:84px}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.7 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;-webkit-font-smoothing:antialiased}
a{color:var(--brand-ink);text-decoration:none}a:hover{text-decoration:underline}
.top{position:sticky;top:0;z-index:30;display:flex;align-items:center;gap:12px;height:64px;padding:0 20px;background:color-mix(in srgb,var(--bg) 85%,transparent);backdrop-filter:blur(12px);border-bottom:1px solid var(--line)}
.brand{white-space:nowrap;display:flex;align-items:center;gap:10px;font-weight:700;color:var(--text);font-size:17px}.brand:hover{text-decoration:none}
.brand img{width:30px;height:30px;border-radius:8px}
.spacer{flex:1}
.btn{display:inline-flex;align-items:center;gap:8px;height:38px;padding:0 14px;border-radius:10px;border:1px solid var(--line);background:var(--panel);color:var(--text);font:600 14px/1 inherit;cursor:pointer}
.btn:hover{border-color:var(--brand);text-decoration:none}
.btn.primary{background:var(--brand);border-color:var(--brand);color:#fff}
.icon-btn{width:38px;padding:0;justify-content:center}
.menu{display:none}
.layout{display:grid;grid-template-columns:280px minmax(0,1fr);max-width:1240px;margin:0 auto}
.side{position:sticky;top:64px;align-self:start;height:calc(100dvh - 64px);overflow:auto;padding:24px 16px 32px 20px;border-inline-end:1px solid var(--line)}
.search{width:100%;height:40px;padding:0 12px;border-radius:10px;border:1px solid var(--line);background:var(--bg2);color:var(--text);font:inherit;font-size:14px;margin-bottom:14px}
.search:focus{outline:2px solid var(--brand);outline-offset:1px}
.side nav a{display:flex;gap:10px;align-items:baseline;padding:7px 10px;border-radius:8px;color:var(--muted);font-size:14.5px;line-height:1.35}
.side nav a:hover{background:var(--bg2);color:var(--text);text-decoration:none}
.side nav a.active{background:color-mix(in srgb,var(--brand) 14%,transparent);color:var(--brand-ink);font-weight:600}
.side nav a.hide{display:none}
.num{min-width:1.4em;opacity:.55;font-variant-numeric:tabular-nums}
main{padding:36px clamp(20px,4vw,56px) 80px;min-width:0}
.hero{display:grid;gap:18px;padding:34px;border:1px solid var(--line);border-radius:20px;background:linear-gradient(135deg,color-mix(in srgb,var(--brand) 14%,var(--panel)),var(--panel));box-shadow:var(--shadow);margin-bottom:36px}
.hero h1{margin:0;font-size:clamp(28px,4vw,40px);line-height:1.15;letter-spacing:-.02em}
.hero p{margin:0;color:var(--muted);font-size:18px;max-width:60ch}
.hero .row{display:flex;gap:10px;flex-wrap:wrap}
.shots{display:flex;gap:14px;overflow:auto;padding:4px 2px 10px;scroll-snap-type:x mandatory}
.shots img{height:340px;width:auto;border-radius:16px;border:1px solid var(--line);box-shadow:var(--shadow);scroll-snap-align:start;flex:none}
article{max-width:820px}
article h2{font-size:28px;line-height:1.25;margin:56px 0 14px;padding-top:8px;letter-spacing:-.01em}
article h2:first-child{margin-top:0}
article h3{font-size:20px;margin:34px 0 8px}
article h4{font-size:16px;margin:24px 0 6px}
.anchor{margin-inline-start:8px;opacity:0;font-weight:400;color:var(--muted)}h2:hover .anchor,h3:hover .anchor{opacity:1}
article p,article li{color:var(--text)}article li{margin:5px 0}article ul,article ol{padding-inline-start:24px}
code{font:.88em ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:var(--code);padding:.15em .4em;border-radius:6px}
pre{background:var(--code);padding:14px 16px;border-radius:12px;overflow:auto}pre code{background:none;padding:0}
kbd{font:600 .82em ui-monospace,monospace;background:var(--bg2);border:1px solid var(--line);border-bottom-width:2px;border-radius:6px;padding:.1em .45em}
.table-wrap{overflow:auto;border:1px solid var(--line);border-radius:12px;margin:16px 0;background:var(--panel)}
table{border-collapse:collapse;width:100%;font-size:15px}
th,td{padding:10px 14px;text-align:start;vertical-align:top;border-bottom:1px solid var(--line)}
th{background:var(--bg2);font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}tr:last-child td{border-bottom:0}
.callout{border-inline-start:4px solid var(--brand);background:color-mix(in srgb,var(--brand) 9%,var(--panel));border-radius:0 12px 12px 0;padding:4px 18px;margin:18px 0}
.callout p{margin:10px 0}
hr.sep{border:0;border-top:1px solid var(--line);margin:40px 0}
.foot{margin-top:64px;padding-top:20px;border-top:1px solid var(--line);color:var(--muted);font-size:14px}
mark{background:color-mix(in srgb,var(--brand) 35%,transparent);color:inherit;border-radius:3px}
@media (max-width:900px){.layout{grid-template-columns:1fr}.menu{display:inline-flex}
.side{position:fixed;inset:64px 0 0 0;height:auto;z-index:25;background:var(--bg);transform:translateX(-102%);transition:transform .2s;border:0;max-width:340px;border-inline-end:1px solid var(--line)}
body.nav-open .side{transform:none}.shots img{height:260px}.hero{padding:22px}.top .label,.brand span{display:none}}
</style>
</head>
<body>
<header class="top">
  <button class="btn icon-btn menu" id="menu" aria-label="Toggle navigation"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg></button>
  <a class="brand" href="#top"><img src="icon.svg" alt="" />XML Translator <span style="color:var(--muted);font-weight:500">Docs</span></a>
  <span class="spacer"></span>
  <a class="btn" href="${REPO}" target="_blank" rel="noopener"><span class="label">GitHub</span><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg></a>
  <button class="btn icon-btn" id="theme" aria-label="Toggle theme"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 3v18" /><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/></svg></button>
</header>
<div class="layout" id="top">
  <aside class="side">
    <input class="search" id="q" type="search" placeholder="Search the guide…" aria-label="Search the guide" />
    <nav id="nav">
${nav}
    </nav>
  </aside>
  <main>
    <section class="hero">
      <h1>XML Translator</h1>
      <p>Translate Android <code>strings.xml</code> files faster, safer and in your own language — with machine translation, built-in quality checks and smart typing helpers.</p>
      <div class="row">
        <a class="btn primary" href="${REPO}/releases/latest" target="_blank" rel="noopener">Download the app</a>
        <a class="btn" href="#2-quick-start">Quick start</a>
        <a class="btn" href="${REPO}" target="_blank" rel="noopener">Source code</a>
      </div>
      <div class="shots">
        <img src="screenshots/editor.jpg" alt="Translation editor" loading="lazy" />
        <img src="screenshots/strings-list.jpg" alt="Strings list with QA checks" loading="lazy" />
        <img src="screenshots/table.jpg" alt="Table view" loading="lazy" />
        <img src="screenshots/providers.png" alt="Translation providers" loading="lazy" />
        <img src="screenshots/multi-language-zip.jpg" alt="Multi-language ZIP" loading="lazy" />
      </div>
    </section>
    <article id="content">
${html}
      <div class="foot">Released under the <a href="${REPO}/blob/main/LICENSE">GNU GPL v3</a>. Found a mistake? <a href="${REPO}/edit/main/docs/GUIDE.md">Edit this page</a>.</div>
    </article>
  </main>
</div>
<script>
(function(){
  var root=document.documentElement,body=document.body;
  document.getElementById('theme').onclick=function(){var dark=root.dataset.theme?root.dataset.theme==='dark':matchMedia('(prefers-color-scheme:dark)').matches;var n=dark?'light':'dark';root.dataset.theme=n;try{localStorage.setItem('docs-theme',n)}catch(e){}};
  document.getElementById('menu').onclick=function(){body.classList.toggle('nav-open')};
  document.querySelectorAll('#nav a').forEach(function(a){a.addEventListener('click',function(){body.classList.remove('nav-open')})});
  // scroll spy
  var links={};document.querySelectorAll('#nav a').forEach(function(a){links[a.dataset.nav]=a});
  var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){Object.values(links).forEach(function(l){l.classList.remove('active')});var l=links[e.target.id];if(l){l.classList.add('active');l.scrollIntoView({block:'nearest'})}}})},{rootMargin:'-80px 0px -70% 0px'});
  document.querySelectorAll('h2[data-section]').forEach(function(h){io.observe(h)});
  // search: filter the section list and highlight matches in the page
  var q=document.getElementById('q'),content=document.getElementById('content');
  var secs=[];document.querySelectorAll('h2[data-section]').forEach(function(h){var t=h.textContent.toLowerCase(),n=h.nextElementSibling;while(n&&!(n.tagName==='H2')){t+=' '+n.textContent.toLowerCase();n=n.nextElementSibling}secs.push({id:h.id,t:t})});
  q.addEventListener('input',function(){var v=q.value.trim().toLowerCase();secs.forEach(function(s){links[s.id].classList.toggle('hide',!!v&&s.t.indexOf(v)<0)})});
  q.addEventListener('keydown',function(e){if(e.key==='Enter'){var first=Object.values(links).find(function(l){return !l.classList.contains('hide')});if(first)location.hash=first.getAttribute('href')}});
})();
</script>
</body>
</html>
`;
writeFileSync('docs/index.html', page);
writeFileSync('docs/.nojekyll', '');
console.log('docs/index.html', page.length, 'bytes,', sections.length, 'sections');
