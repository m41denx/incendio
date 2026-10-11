import { ApiError } from "../lib/errors.ts";

export interface HydraClientRef {
  client_id?: string;
  client_name?: string;
  metadata?: Record<string, unknown> | null;
}

export interface LoginRequest {
  challenge: string;
  skip: boolean;
  subject: string;
  client: HydraClientRef;
  request_url: string;
}

export interface ConsentRequest {
  challenge: string;
  skip: boolean;
  subject: string;
  requested_scope: string[];
  requested_access_token_audience: string[];
  client: HydraClientRef;
}

/** The subset of Hydra's OAuth2 client we manage. */
export interface OAuth2Client extends HydraClientRef {
  client_secret?: string;
  grant_types?: string[];
  response_types?: string[];
  redirect_uris?: string[];
  post_logout_redirect_uris?: string[];
  scope?: string;
  audience?: string[];
  token_endpoint_auth_method?: string;
  skip_consent?: boolean;
  access_token_strategy?: string;
}

export interface HydraAdminApi {
  getLogin(challenge: string): Promise<LoginRequest>;
  acceptLogin(challenge: string, body: { subject: string; remember?: boolean; remember_for?: number }): Promise<string>;
  rejectLogin(challenge: string, body: { error: string; error_description?: string }): Promise<string>;
  getConsent(challenge: string): Promise<ConsentRequest>;
  acceptConsent(challenge: string, body: Record<string, unknown>): Promise<string>;
  rejectConsent(challenge: string, body: { error: string; error_description?: string }): Promise<string>;
  acceptDevice(challenge: string, userCode: string): Promise<string>;
  acceptLogout(challenge: string): Promise<string>;
  getClient(id: string): Promise<OAuth2Client | null>;
  createClient(c: OAuth2Client): Promise<OAuth2Client>;
  updateClient(c: OAuth2Client): Promise<OAuth2Client>;
  deleteClient(id: string): Promise<void>;
}

/** Ory Hydra's admin API (v2 paths). */
export class HydraAdmin implements HydraAdminApi {
  private readonly base: string;
  constructor(
    adminUrl: string,
    private readonly opts: { ca?: string } = {},
  ) {
    this.base = adminUrl.replace(/\/$/, "");
  }

  private async call<T>(method: string, path: string, body?: unknown, allow404 = false): Promise<T | null> {
    const res = await fetch(this.base + path, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      tls: this.opts.ca ? { ca: this.opts.ca } : undefined,
    } as RequestInit);
    if (allow404 && res.status === 404) return null;
    if (res.status === 404 || res.status === 410) {
      throw new ApiError(404, "challenge_not_found", "This sign-in request has expired or was already used. Start again from your application.");
    }
    if (res.status === 400) {
      const err = (await res.json().catch(() => ({}))) as { error_description?: string };
      throw new ApiError(400, "invalid_request", err.error_description ?? "The identity provider rejected the request");
    }
    if (!res.ok) {
      const text = await res.text();
      throw new ApiError(502, "identity_error", `Identity provider answered ${res.status}: ${text.slice(0, 300)}`);
    }
    return res.status === 204 ? (null as T) : ((await res.json()) as T);
  }

  private redirect = async (method: string, path: string, body: unknown) => (await this.call<{ redirect_to: string }>(method, path, body))!.redirect_to;
  private q = (kind: string, ch: string) => `/admin/oauth2/auth/requests/${kind}?${kind}_challenge=${encodeURIComponent(ch)}`;
  private qa = (kind: string, verb: string, ch: string) => `/admin/oauth2/auth/requests/${kind}/${verb}?${kind}_challenge=${encodeURIComponent(ch)}`;

  async getLogin(ch: string) {
    return (await this.call<LoginRequest>("GET", this.q("login", ch)))!;
  }
  acceptLogin(ch: string, body: { subject: string; remember?: boolean; remember_for?: number }) {
    return this.redirect("PUT", this.qa("login", "accept", ch), body);
  }
  rejectLogin(ch: string, body: { error: string; error_description?: string }) {
    return this.redirect("PUT", this.qa("login", "reject", ch), body);
  }
  async getConsent(ch: string) {
    return (await this.call<ConsentRequest>("GET", this.q("consent", ch)))!;
  }
  acceptConsent(ch: string, body: Record<string, unknown>) {
    return this.redirect("PUT", this.qa("consent", "accept", ch), body);
  }
  rejectConsent(ch: string, body: { error: string; error_description?: string }) {
    return this.redirect("PUT", this.qa("consent", "reject", ch), body);
  }
  acceptDevice(ch: string, userCode: string) {
    return this.redirect("PUT", this.qa("device", "accept", ch), { user_code: userCode });
  }
  acceptLogout(ch: string) {
    return this.redirect("PUT", this.qa("logout", "accept", ch), {});
  }
  getClient(id: string) {
    return this.call<OAuth2Client>("GET", `/admin/clients/${encodeURIComponent(id)}`, undefined, true);
  }
  async createClient(c: OAuth2Client) {
    return (await this.call<OAuth2Client>("POST", "/admin/clients", c))!;
  }
  async updateClient(c: OAuth2Client) {
    return (await this.call<OAuth2Client>("PUT", `/admin/clients/${encodeURIComponent(c.client_id!)}`, c))!;
  }
  async deleteClient(id: string) {
    await this.call("DELETE", `/admin/clients/${encodeURIComponent(id)}`, undefined, true);
  }
}
