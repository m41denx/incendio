import type { ConsentRequest, HydraAdminApi, LoginRequest, OAuth2Client } from "./hydra-admin.ts";
import { ApiError } from "../lib/errors.ts";

/** In-memory stand-in for Hydra's admin API, for route tests. */
export class FakeHydra implements HydraAdminApi {
  logins = new Map<string, LoginRequest>();
  consents = new Map<string, ConsentRequest>();
  devices = new Set<string>();
  logouts = new Set<string>();
  accepted: Array<{ kind: string; challenge: string; body: unknown }> = [];
  rejected: Array<{ kind: string; challenge: string; body: unknown }> = [];
  clients = new Map<string, OAuth2Client>();
  validCodes?: Set<string>;

  private need<T>(m: Map<string, T>, ch: string): T {
    const v = m.get(ch);
    if (!v) throw new ApiError(404, "challenge_not_found", "The login request has expired or was already used");
    return v;
  }
  async getLogin(ch: string) {
    return this.need(this.logins, ch);
  }
  async acceptLogin(ch: string, body: unknown) {
    this.need(this.logins, ch);
    this.accepted.push({ kind: "login", challenge: ch, body });
    return `https://hydra.test/after-login?ch=${ch}`;
  }
  async rejectLogin(ch: string, body: unknown) {
    this.rejected.push({ kind: "login", challenge: ch, body });
    return `https://hydra.test/rejected-login?ch=${ch}`;
  }
  async getConsent(ch: string) {
    return this.need(this.consents, ch);
  }
  async acceptConsent(ch: string, body: unknown) {
    this.need(this.consents, ch);
    this.accepted.push({ kind: "consent", challenge: ch, body });
    return `https://hydra.test/after-consent?ch=${ch}`;
  }
  async rejectConsent(ch: string, body: unknown) {
    this.rejected.push({ kind: "consent", challenge: ch, body });
    return `https://hydra.test/rejected-consent?ch=${ch}`;
  }
  async acceptDevice(ch: string, userCode: string) {
    if (!this.devices.has(ch)) throw new ApiError(404, "challenge_not_found", "expired");
    if (this.validCodes && !this.validCodes.has(userCode)) throw new ApiError(400, "invalid_request", "The 'user_code' session could not be found");
    this.accepted.push({ kind: "device", challenge: ch, body: { user_code: userCode } });
    return `https://hydra.test/after-device?ch=${ch}`;
  }
  async acceptLogout(ch: string) {
    if (!this.logouts.has(ch)) throw new ApiError(404, "challenge_not_found", "expired");
    return `https://hydra.test/after-logout?ch=${ch}`;
  }
  async getClient(id: string) {
    return this.clients.get(id) ?? null;
  }
  async createClient(c: OAuth2Client) {
    this.clients.set(c.client_id!, c);
    return c;
  }
  async updateClient(c: OAuth2Client) {
    this.clients.set(c.client_id!, c);
    return c;
  }
  async deleteClient(id: string) {
    this.clients.delete(id);
  }
}

export const firstParty = { client_id: "incus-cli", client_name: "Incus CLI", metadata: { first_party: true } };
