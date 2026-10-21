import type { TokenEndpoint, TokenSet } from "./session.ts";

/** Hydra's token endpoint, faked with a local signer. */
export class FakeTokens implements TokenEndpoint {
  codes = new Map<string, { sub: string; verifier: string }>();
  refreshable = new Map<string, string>(); // refresh token → sub
  exchanged: Array<{ code: string; verifier: string; redirectUri: string }> = [];
  constructor(private readonly sign: (claims: { sub: string }) => Promise<string>) {}

  private async issue(sub: string): Promise<TokenSet> {
    const refreshToken = `rt-${crypto.randomUUID()}`;
    this.refreshable.set(refreshToken, sub);
    return { accessToken: await this.sign({ sub }), refreshToken, idToken: "id-token", expiresIn: 3600 };
  }
  async exchange(code: string, verifier: string, redirectUri: string) {
    this.exchanged.push({ code, verifier, redirectUri });
    const c = this.codes.get(code);
    if (!c || c.verifier !== verifier) throw new Error("invalid_grant");
    this.codes.delete(code);
    return this.issue(c.sub);
  }
  async refresh(refreshToken: string) {
    const sub = this.refreshable.get(refreshToken);
    if (!sub) throw new Error("invalid_grant");
    this.refreshable.delete(refreshToken);
    return this.issue(sub);
  }
}
