import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.translator.androidstrings',
  appName: 'XML Translator',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  },
  android: {
    allowMixedContent: false,
    webContentsDebuggingEnabled: false
  },
  plugins: {
    CapacitorHttp: {
      enabled: true
    },
    SystemBars: {
      // exposes --safe-area-inset-* so the page can keep clear of the status / navigation bars
      insetsHandling: 'css'
    }
  }
};

export default config;
