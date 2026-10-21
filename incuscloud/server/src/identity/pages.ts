import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Server-rendered identity pages (login, device, messages): no JavaScript.
 * They use the platform UI's own stylesheet in Incendio's frame, so they look
 * like the rest of IncusCloud.
 */

export const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** A page's title and the content of its login block. */
export interface View {
  title: string;
  body: string;
}

const LOGO = '<a class="p-panel__logo" href="/"><img src="/assets/img/incuscloud-logo.svg" alt="" class="p-panel__logo-image"><div class="logo-text p-heading--4">IncusCloud</div></a>';

/** The full page: Incendio's navigation (logo only) and the view in its centred login block. */
export function page(view: View, stylesheet?: string): string {
  const css = stylesheet ? `<link rel="stylesheet" href="${escapeHtml(stylesheet)}">` : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(view.title)} · IncusCloud</title><link rel="icon" href="/assets/favicon.svg">${css}</head><body><div class="l-application" id="l-application">
<header class="l-navigation-bar"><div class="p-panel is-dark"><div class="p-panel__header">${LOGO}</div></div></header>
<nav class="l-navigation is-pinned u-hide--small" aria-label="main navigation"><div class="l-navigation__drawer"><div class="p-panel is-dark"><div class="p-panel__header is-sticky">${LOGO}</div><div class="p-panel__content"></div></div></div></nav>
<main class="l-main" id="main-content"><div class="p-panel"><div class="p-panel__content"><div class="login"><div class="login-page">${view.body}</div></div></div></div></main>
</div></body></html>`;
}

let cached: { dir: string; mtimeMs: number; href?: string } | undefined;

/** The stylesheet the web build's index.html links (re-read when the build changes); undefined without a build. */
export function webStylesheet(dir: string): string | undefined {
  const file = join(dir, "index.html");
  let mtimeMs: number;
  try {
    mtimeMs = statSync(file).mtimeMs;
  } catch {
    return undefined;
  }
  if (cached?.dir === dir && cached.mtimeMs === mtimeMs) return cached.href;
  const html = readFileSync(file, "utf8");
  const href = /<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"/.exec(html)?.[1] ?? /<link\b[^>]*href="([^"]+\.css)"/.exec(html)?.[1];
  cached = { dir, mtimeMs, href };
  return href;
}

const hidden = (name: string, value: string) => `<input type="hidden" name="${name}" value="${escapeHtml(value)}">`;
const error = (msg?: string) =>
  msg ? `<div class="p-notification--negative"><div class="p-notification__content"><p class="p-notification__message" role="alert">${escapeHtml(msg)}</p></div></div>` : "";
const heading = (title: string, lead: string) => `<h1 class="p-heading--4">${escapeHtml(title)}</h1><p class="u-text--muted">${lead}</p>`;

const providerButtons = (challenge: string, providers: Array<{ slug: string; name: string }> = []) =>
  providers.length
    ? `<div class="auth-container auth-providers u-align--left">${providers
        .map((p) => `<a class="p-button" href="/auth/federation/${encodeURIComponent(p.slug)}?login_challenge=${encodeURIComponent(challenge)}">Sign in with ${escapeHtml(p.name)}</a>`)
        .join("")}<p class="u-text--muted u-align--center">or with your IncusCloud password</p></div>`
    : "";

export const loginPage = (o: { challenge: string; csrf: string; email?: string; error?: string; client?: string; providers?: Array<{ slug: string; name: string }> }): View => ({
  title: "Sign in",
  body: `${heading("Sign in", o.client ? `to continue to ${escapeHtml(o.client)}` : "to IncusCloud")}${providerButtons(o.challenge, o.providers)}
<form class="p-form auth-container u-align--left" method="post" action="/auth/login">${hidden("challenge", o.challenge)}${hidden("csrf", o.csrf)}
${error(o.error)}<label for="email">Email</label><input id="email" name="email" type="email" autocomplete="username" required autofocus value="${escapeHtml(o.email ?? "")}">
<label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required>
<button type="submit" class="p-button--positive">Sign in</button></form>`,
});

export const devicePage = (o: { challenge: string; csrf: string; userCode?: string; error?: string }): View => ({
  title: "Connect a device",
  body: `${heading("Connect a device", "Enter the code shown by the command line tool.")}
<form class="p-form auth-container u-align--left" method="post" action="/auth/device">${hidden("challenge", o.challenge)}${hidden("csrf", o.csrf)}
${error(o.error)}<label for="user_code">Code</label><input id="user_code" name="user_code" autocomplete="off" required autofocus value="${escapeHtml(o.userCode ?? "")}">
<button type="submit" class="p-button--positive">Continue</button></form>`,
});

export const messagePage = (title: string, message: string): View => ({ title, body: heading(title, escapeHtml(message)) });
