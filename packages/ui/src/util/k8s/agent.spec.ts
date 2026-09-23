import { agentRequest, verifyAgentToken } from "./agent";

const respond = (status: number, body: unknown) =>
  vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );

describe("verifyAgentToken", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the bearer token to an authenticated endpoint", async () => {
    const fetchMock = respond(200, { clusters: [] });
    vi.stubGlobal("fetch", fetchMock);
    await verifyAgentToken({ url: "https://a:8843/", token: "good" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://a:8843/v1/clusters");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer good",
    );
  });

  it("rejects a token the agent refuses, with an actionable message", async () => {
    vi.stubGlobal("fetch", respond(401, { error: "unauthorized" }));
    await expect(
      verifyAgentToken({ url: "https://a:8843", token: "stale" }),
    ).rejects.toThrow(/token/i);
  });
});

describe("agentRequest errors", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("includes the agent's detail, not just the generic error", async () => {
    vi.stubGlobal(
      "fetch",
      respond(502, {
        error: "failed to create cluster",
        detail: "TLS verification of the Incus server certificate failed",
      }),
    );
    await expect(
      agentRequest({ url: "https://a:8843", token: "t" }, "/v1/clusters"),
    ).rejects.toThrow(
      "failed to create cluster: TLS verification of the Incus server certificate failed",
    );
  });

  it("falls back to whichever field is present", async () => {
    vi.stubGlobal("fetch", respond(404, { error: "not found" }));
    await expect(
      agentRequest({ url: "https://a:8843", token: "t" }, "/v1/clusters/x"),
    ).rejects.toThrow(/^not found$/);
  });

  it("shows the agent's validation message (Elysia 422 body)", async () => {
    vi.stubGlobal(
      "fetch",
      respond(422, {
        type: "validation",
        on: "body",
        message:
          "control plane needs at least 2 CPUs (kubeadm refuses to initialize with fewer); got 'c1-m2'",
      }),
    );
    await expect(
      agentRequest({ url: "https://a:8843", token: "t" }, "/v1/clusters"),
    ).rejects.toThrow(/at least 2 CPUs/);
  });
});
