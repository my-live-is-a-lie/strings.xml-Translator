import { getStoredItem, setStoredItem } from './storage';

export type AppTheme = 'day' | 'night' | 'black_hole';

/**
 * Synchronously applies the app theme to documentElement, CSS custom properties,
 * and dynamically updates the <meta name="color-scheme"> and <meta name="theme-color">
 * tags to force browsers (including Chrome, Brave, Safari) to respect light/dark rendering.
 */
export function applyAppTheme(theme: AppTheme): void {
  if (typeof document === 'undefined') return;

  const root = document.documentElement;
  const isDay = theme === 'day';
  const isBlackHole = theme === 'black_hole';
  const scheme = isDay ? 'light' : 'dark';

  if (isDay) {
    root.classList.remove('dark');
    root.setAttribute('data-theme', 'day');
  } else if (isBlackHole) {
    root.classList.add('dark');
    root.setAttribute('data-theme', 'black-hole');
  } else {
    root.classList.add('dark');
    root.setAttribute('data-theme', 'night');
  }

  // Set explicit CSS color-scheme property on root element
  root.style.colorScheme = scheme;

  // Dynamically update or create <meta name="color-scheme">
  let metaScheme = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]');
  if (!metaScheme) {
    metaScheme = document.createElement('meta');
    metaScheme.name = 'color-scheme';
    document.head.appendChild(metaScheme);
  }
  metaScheme.setAttribute('content', scheme);

  // Dynamically update or create <meta name="theme-color">
  let metaTheme = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!metaTheme) {
    metaTheme = document.createElement('meta');
    metaTheme.name = 'theme-color';
    document.head.appendChild(metaTheme);
  }
  const themeBgColor = isDay ? '#f8f9fa' : (isBlackHole ? '#000000' : '#111318');
  metaTheme.setAttribute('content', themeBgColor);

  // Persist to storage
  setStoredItem('app_theme', theme);
}

export function getInitialAppTheme(): AppTheme {
  const saved = getStoredItem('app_theme');
  if (saved === 'day' || saved === 'night' || saved === 'black_hole') {
    return saved as AppTheme;
  }
  return 'night';
}
