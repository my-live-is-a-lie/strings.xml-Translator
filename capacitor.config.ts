import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.translator.androidstrings',
  appName: 'XML Translator',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  }
};

export default config;
