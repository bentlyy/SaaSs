/** Utilidades de URL y la página de error que ve el usuario (nada de JSON). */

export function appendQuery(base: string, params: Record<string, string | undefined>): string {
  const pairs = Object.entries(params)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1] !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  if (pairs.length === 0) return base;
  return base + (base.includes('?') ? '&' : '?') + pairs.join('&');
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Página de error autocontenida: ni CSS externo ni JS ni fuentes de terceros. */
export function errorPage(options: {
  title: string;
  message: string;
  loginUrl?: string;
  productName?: string;
}): string {
  const action = options.loginUrl
    ? `<a class="btn" href="${escapeHtml(options.loginUrl)}">Iniciar sesión</a>`
    : '';
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(options.title)}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; min-height:100vh; display:grid; place-items:center; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; background:#0f1115; color:#e7e9ee; }
  .card { max-width: 30rem; padding: 2.5rem; text-align:center; }
  h1 { font-size: 1.35rem; margin: 0 0 .75rem; }
  p { margin: 0 0 1.5rem; line-height: 1.55; color: #a6adbb; }
  .btn { display:inline-block; padding: .7rem 1.2rem; border-radius: 8px; background: #3b82f6; color:#fff; text-decoration:none; font-weight:600; }
  .btn:hover { background: #2f6fd8; }
  small { display:block; margin-top: 2rem; color:#6b7280; }
</style>
</head>
<body>
  <main class="card">
    <h1>${escapeHtml(options.title)}</h1>
    <p>${escapeHtml(options.message)}</p>
    ${action}
    <small>${escapeHtml(options.productName ?? 'AMG')}</small>
  </main>
</body>
</html>`;
}
