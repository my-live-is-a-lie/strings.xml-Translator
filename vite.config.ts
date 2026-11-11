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

// Web demo build (published under /demo/ of the docs site): no service worker (it would take over the docs
// site's scope) and hidden from search engines so it does not compete with the docs page.
const isDemo = process.env.VITE_DEMO === '1';
const demoPlugin = {
  name: 'demo-plugin',
  transformIndexHtml(html: string) {
    return isDemo ? html.replace('</head>', '    <meta name="robots" content="noindex, nofollow" />\n  </head>') : html;
  },
};

export default defineConfig(() => {
  return {
    plugins: [
      cspPlugin,
      demoPlugin,
      react(),
      tailwindcss(),
      ...(isDemo ? [] : [VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['icon.svg'],
        manifest: {
          id: '/',
          name: 'Android Strings XML Translator',
          short_name: 'StringsTrans',
          description: 'Offline Android strings.xml translator inspired by Weblate',
          theme_color: '#2563eb',
          background_color: '#f8fafc',
          display: 'standalone',
          start_url: '/',
          scope: '/',
          icons: [
            {
              src: '/icon.svg',
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
      })]),
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
