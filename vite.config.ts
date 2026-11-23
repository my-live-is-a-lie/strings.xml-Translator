import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';

// The CSP <meta> is only for production builds: the dev server injects inline scripts (React refresh).
const apiBaseOrigin = (() => {
  try {
    return process.env.VITE_API_BASE ? new URL(process.env.VITE_API_BASE).origin : '';
  } catch {
    return '';
  }
})();

const cspPlugin = {
  name: 'csp-plugin',
  transformIndexHtml(html: string, ctx: { server?: unknown }) {
    if (ctx.server) {
      // Dev server injects inline scripts (React refresh), which the policy would block.
      return html.replace(/\s*<meta http-equiv="Content-Security-Policy"[^>]*>/, '');
    }
    return apiBaseOrigin
      ? html.replace("connect-src 'self'", `connect-src 'self' ${apiBaseOrigin}`)
      : html;
  },
};

// Web demo build (published under /demo/ of the docs site): it is a public,
// indexable page of the site, like the docs page. It still gets its own
// installable PWA manifest/service worker, scoped to /demo/ (via --base),
// so it can't reach outside that path and never touches the docs site's own scope.
const isDemo = process.env.VITE_DEMO === '1';
const demoBase = '/demo/';

// The SEO head tags belong to the public demo only. index.html is also the entry of the
// regular build (the Android app bundles it via Capacitor, and previews use it), so it
// stays neutral and these are injected only when VITE_DEMO=1.
const SITE = 'https://xml-translator.is-a.dev/';
const demoTitle = 'XML Translator \u2013 Try the Android strings.xml Translator Online';
const demoSocialTitle = 'XML Translator \u2013 Android strings.xml Translator Online';
export function demoDocumentLanguage(html: string, demo: boolean): string {
  if (!demo) return html;
  return html.replace(/<html\b[^>]*>/i, (tag) =>
    tag.replace(/\blang\s*=\s*(["'])[^"']*\1/i, 'lang="en"')
      .replace(/\bdir\s*=\s*(["'])[^"']*\1/i, 'dir="ltr"'),
  );
}
const demoPlugin = {
  name: 'demo-plugin',
  transformIndexHtml(html: string) {
    if (!isDemo) return html;
    const description = html.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? '';
    const head = [
      '<meta name="robots" content="index, follow, max-image-preview:large" />',
      `<link rel="canonical" href="${SITE}demo/" />`,
      '<meta property="og:site_name" content="XML Translator" />',
      `<meta property="og:url" content="${SITE}demo/" />`,
      `<meta property="og:image" content="${SITE}og.png" />`,
      '<meta property="og:image:width" content="1200" />',
      '<meta property="og:image:height" content="630" />',
      '<meta property="og:image:alt" content="XML Translator editing an Android strings.xml file" />',
      `<meta name="twitter:title" content="${demoSocialTitle}" />`,
      `<meta name="twitter:description" content="${description}" />`,
      `<meta name="twitter:image" content="${SITE}og.png" />`,
    ]
      .map((t) => `    ${t}`)
      .join('\n');
    // Static text for crawlers and visitors without JavaScript (the app itself renders client-side).
    const fallback =
      '<noscript><main><h1>XML Translator</h1><p>Translate Android strings.xml localization files in your browser, ' +
      'with placeholder protection and quality checks. Everything runs on your device. ' +
      `<a href="${SITE}">Read the guide</a>.</p></main></noscript>`;
    return demoDocumentLanguage(html, isDemo)
      // The app is Arabic/RTL by default and switches lang/dir at runtime; this demo build ships English
      // head tags and fallback text, so the initial HTML (what a crawler sees before JS runs) must match.
      .replace(/<title>[^<]*<\/title>/, `<title>${demoTitle}</title>`)
      .replace('<meta property="og:title" content="XML Translator" />', `<meta property="og:title" content="${demoSocialTitle}" />`)
      .replace('</head>', `${head}\n  </head>`)
      .replace('<div id="root"></div>', `<div id="root"></div>\n    ${fallback}`);
  },
};

export default defineConfig(() => {
  return {
    plugins: [
      cspPlugin,
      demoPlugin,
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['icon.svg'],
        manifest: {
          id: isDemo ? demoBase : '/',
          name: 'Android Strings XML Translator',
          short_name: 'StringsTrans',
          description: 'Offline Android strings.xml translator inspired by Weblate',
          theme_color: '#2563eb',
          background_color: '#f8fafc',
          display: 'standalone',
          start_url: isDemo ? demoBase : '/',
          scope: isDemo ? demoBase : '/',
          icons: [
            {
              src: 'icon.svg',
              sizes: '512x512',
              type: 'image/svg+xml',
              purpose: 'any',
            },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
        },
        devOptions: {
          enabled: false,
        },
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
