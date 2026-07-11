/* iOS haptics — single source for the app.
   Uses `ios-haptics` from npm via importmap, with a graceful
   navigator.vibrate fallback so this never crashes on desktop. */
let h;
try {
  const mod = await import('ios-haptics');
  h = mod.haptic || mod.default;
  if (typeof h !== 'function') throw new Error('no haptic export');
} catch (_) {
  const v = (pat) => { try { navigator.vibrate && navigator.vibrate(pat); } catch {} };
  h = Object.assign(() => v(10), {
    confirm: () => v([12, 60, 12]),
    error:   () => v([20, 40, 20, 40, 20]),
  });
}
window.haptic = h;
window.dispatchEvent(new Event('haptic-ready'));
