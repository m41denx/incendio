import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { devicePage, loginPage, messagePage, page, webStylesheet } from "./pages.ts";

const login = () => page(loginPage({ challenge: "c1", csrf: "x1", client: "IncusCloud web", error: "Wrong email or password", email: 'a"<b>' }), "/assets/index-abc.css");

test("sign-in pages are Incendio's frame: the web build's stylesheet, the dark navigation with the logo, the main area", () => {
  const html = login();
  expect(html).toContain('<link rel="stylesheet" href="/assets/index-abc.css">');
  expect(html).toContain('<nav class="l-navigation is-pinned u-hide--small" aria-label="main navigation">');
  expect(html).toContain('<div class="p-panel is-dark">');
  expect(html).toContain('<img src="/assets/img/incuscloud-logo.svg" alt="" class="p-panel__logo-image"><div class="logo-text p-heading--4">IncusCloud</div>');
  expect(html).toContain('<main class="l-main" id="main-content">');
  expect(html).toContain('<div class="login"><div class="login-page">');
});

test("no inline styling of their own: no style element, no rounded corners", () => {
  for (const html of [login(), page(devicePage({ challenge: "c", csrf: "x" })), page(messagePage("Device connected", "Close this window."))]) {
    expect(html).not.toContain("<style");
    expect(html).not.toContain("border-radius");
  }
});

test("the login form is a Vanilla form: labelled fields, a positive button, the error as a negative notification", () => {
  const html = login();
  expect(html).toContain('<form class="p-form auth-container u-align--left" method="post" action="/auth/login">');
  expect(html).toContain('<label for="email">Email</label><input id="email" name="email" type="email"');
  expect(html).toContain('<button type="submit" class="p-button--positive">Sign in</button>');
  expect(html).toContain('<div class="p-notification--negative"><div class="p-notification__content"><p class="p-notification__message" role="alert">Wrong email or password</p></div></div>');
  expect(html).toContain('value="a&quot;&lt;b&gt;"');
  expect(html).toContain('<h1 class="p-heading--4">Sign in</h1>');
});

test("without a web build the pages still work, unstyled", () => {
  const html = page(messagePage("Sign-in failed", "x"));
  expect(html).not.toContain("<link rel=\"stylesheet\"");
  expect(html).toContain("<h1 class=\"p-heading--4\">Sign-in failed</h1>");
});

test("the web build's stylesheet is read from its index.html, and follows a rebuild", () => {
  const dir = mkdtempSync(join(tmpdir(), "ic-web-"));
  const write = (css: string) => writeFileSync(join(dir, "index.html"), `<!doctype html><head><script type="module" crossorigin src="/assets/index-1.js"></script><link rel="stylesheet" crossorigin href="${css}"></head>`);
  write("/assets/index-one.css");
  expect(webStylesheet(dir)).toBe("/assets/index-one.css");
  write("/assets/index-two.css");
  expect(webStylesheet(dir)).toBe("/assets/index-two.css");
  expect(webStylesheet(join(dir, "missing"))).toBeUndefined();
});
