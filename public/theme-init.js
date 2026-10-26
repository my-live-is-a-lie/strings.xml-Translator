// Applies the saved theme before first paint. Kept external so the CSP can block inline scripts.
(function() {
  try {
    var t = localStorage.getItem('app_theme') || 'night';
    var isDay = t === 'day';
    var scheme = isDay ? 'only light' : 'dark';
    var root = document.documentElement;
    if (isDay) {
      root.classList.remove('dark');
      root.setAttribute('data-theme', 'day');
      root.style.colorScheme = 'only light';
    } else {
      root.classList.add('dark');
      root.setAttribute('data-theme', t === 'black_hole' ? 'black-hole' : 'night');
      root.style.colorScheme = 'dark';
    }
    var metaScheme = document.querySelector('meta[name="color-scheme"]');
    if (metaScheme) metaScheme.setAttribute('content', scheme);
    var metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) metaTheme.setAttribute('content', isDay ? '#f8f9fa' : (t === 'black_hole' ? '#000000' : '#111318'));
    var ui = localStorage.getItem('app_ui_language') === 'en' ? 'en' : 'ar';
    root.setAttribute('lang', ui);
    root.setAttribute('dir', ui === 'ar' ? 'rtl' : 'ltr');
    var a = localStorage.getItem('app_accent_color') || 'teal';
    root.setAttribute('data-accent', a);
  } catch (e) {}
})();
