// Runs before the first paint so the page never flashes the wrong theme.
// It is a separate file, not an inline script, so the Content-Security-Policy
// can forbid inline scripts altogether.
(() => {
  let stored = null;
  try {
    stored = window.localStorage.getItem('signoff-ledger-theme');
  } catch {
    stored = null;
  }
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const fallback = prefersDark ? 'dark' : 'light';
  const theme = stored === 'light' || stored === 'dark' ? stored : fallback;
  document.documentElement.setAttribute('data-theme', theme);
})();
