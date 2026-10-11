/** Server-rendered identity pages: no JavaScript, one inline stylesheet. */

export const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const style = `
:root{--bg:#f7f7f7;--fg:#111;--muted:#666;--card:#fff;--line:#d9d9d9;--accent:#e95420;--err:#c7162b}
@media (prefers-color-scheme:dark){:root{--bg:#1b1b1b;--fg:#f2f2f2;--muted:#aaa;--card:#262626;--line:#444}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif;padding:16px}
main{width:100%;max-width:380px;background:var(--card);border:1px solid var(--line);border-radius:8px;padding:28px}
h1{font-size:1.35rem;margin:0 0 4px}p{color:var(--muted);margin:0 0 20px}
label{display:block;font-size:.9rem;margin:14px 0 4px}
input{width:100%;padding:9px 10px;border:1px solid var(--line);border-radius:4px;background:transparent;color:inherit;font:inherit}
button{margin-top:22px;width:100%;padding:10px;border:0;border-radius:4px;background:var(--accent);color:#fff;font:inherit;font-weight:600;cursor:pointer}
.err{color:var(--err);margin:12px 0 0}.brand{font-weight:700;letter-spacing:.02em;color:var(--accent);margin-bottom:18px}`;

export function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · IncusCloud</title><style>${style}</style></head><body><main><div class="brand">IncusCloud</div>${body}</main></body></html>`;
}

const hidden = (name: string, value: string) => `<input type="hidden" name="${name}" value="${escapeHtml(value)}">`;
const error = (msg?: string) => (msg ? `<p class="err" role="alert">${escapeHtml(msg)}</p>` : "");

export const loginPage = (o: { challenge: string; csrf: string; email?: string; error?: string; client?: string }) =>
  page(
    "Sign in",
    `<h1>Sign in</h1><p>${o.client ? `to continue to ${escapeHtml(o.client)}` : "to IncusCloud"}</p>
<form method="post" action="/auth/login">${hidden("challenge", o.challenge)}${hidden("csrf", o.csrf)}
<label for="email">Email</label><input id="email" name="email" type="email" autocomplete="username" required autofocus value="${escapeHtml(o.email ?? "")}">
<label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required>
${error(o.error)}<button type="submit">Sign in</button></form>`,
  );

export const devicePage = (o: { challenge: string; csrf: string; userCode?: string; error?: string }) =>
  page(
    "Connect a device",
    `<h1>Connect a device</h1><p>Enter the code shown by the command line tool.</p>
<form method="post" action="/auth/device">${hidden("challenge", o.challenge)}${hidden("csrf", o.csrf)}
<label for="user_code">Code</label><input id="user_code" name="user_code" autocomplete="off" required autofocus value="${escapeHtml(o.userCode ?? "")}">
${error(o.error)}<button type="submit">Continue</button></form>`,
  );

export const messagePage = (title: string, message: string) => page(title, `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>`);
