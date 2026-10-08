// Keep legacy renderers out of the normal startup path. The moor starts with the lean engine.
const params = new URLSearchParams(location.search);
const boot = import.meta.env.VITE_INCLUDE_LEGACY !== '0' && params.has('v1')
  ? import('./main-v1').then((m) => m.run(params))
  : import.meta.env.VITE_INCLUDE_LEGACY !== '0' && params.has('v2')
    ? import('./v2/main').then((m) => m.run(params))
    : import('./v3/main').then((m) => m.run(params));
boot.catch((e) => {
  console.error(e);
  (window as any).__error = String(e?.stack || e);
  const d = document.createElement('div');
  d.setAttribute('role', 'alert');
  d.style.cssText = 'position:fixed;inset:0;display:grid;place-content:center;gap:18px;color:#ddd;font:16px Georgia,serif;padding:24px;text-align:center;background:#1d2020;z-index:20';
  const text = document.createElement('p');
  text.textContent = 'The moor could not be prepared. Enable WebGL in your browser, then try again.';
  const retry = document.createElement('button');
  retry.textContent = 'Try again'; retry.onclick = () => location.reload();
  d.append(text, retry); document.body.appendChild(d);
});
