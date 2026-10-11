/** A minimal cookie-keeping browser for driving OAuth2 redirects in tests. */
export class TestBrowser {
  private jar = new Map<string, Map<string, string>>(); // host (no port) → cookies
  constructor(private readonly ca: string) {}

  private cookies(url: URL) {
    const j = this.jar.get(url.hostname);
    return j ? [...j].map(([k, v]) => `${k}=${v}`).join("; ") : "";
  }
  private store(url: URL, res: Response) {
    const j = this.jar.get(url.hostname) ?? new Map<string, string>();
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const i = pair!.indexOf("=");
      const v = pair!.slice(i + 1);
      if (/max-age=0|expires=thu, 01 jan 1970/i.test(c) || v === "") j.delete(pair!.slice(0, i));
      else j.set(pair!.slice(0, i), v);
    }
    this.jar.set(url.hostname, j);
  }

  /** Requests a URL and follows redirects; returns the final response and its URL. */
  async go(start: string, init: { method?: string; form?: Record<string, string> } = {}): Promise<{ res: Response; url: string; body: string }> {
    let url = new URL(start);
    let method = init.method ?? "GET";
    let body: URLSearchParams | undefined = init.form ? new URLSearchParams(init.form) : undefined;
    for (let hops = 0; hops < 20; hops++) {
      const headers: Record<string, string> = { cookie: this.cookies(url) };
      if (body) headers["content-type"] = "application/x-www-form-urlencoded";
      const res = await fetch(url, { method, headers, body, redirect: "manual", tls: { ca: this.ca } } as RequestInit);
      this.store(url, res);
      const loc = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && loc) {
        url = new URL(loc, url);
        method = "GET";
        body = undefined;
        continue;
      }
      return { res, url: url.toString(), body: await res.text() };
    }
    throw new Error("too many redirects");
  }

  /** Submits the page's only form with extra fields. */
  async submit(page: { url: string; body: string }, fields: Record<string, string>) {
    const action = page.body.match(/<form method="post" action="([^"]+)"/)![1]!;
    const hidden = Object.fromEntries([...page.body.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)"/g)].map((m) => [m[1]!, m[2]!]));
    return this.go(new URL(action, page.url).toString(), { method: "POST", form: { ...hidden, ...fields } });
  }
}
