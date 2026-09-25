import { Resource } from "./base/request";
import type { EtagOptions, ScopeOptions, WithEtag } from "./base/types";
import type {
  MetadataConfiguration,
  Resources,
  Server,
  ServerPut,
} from "./types/generated";
import type { DeepPartial } from "../utils/types";

/** `/1.0` — server info and configuration, host resources, metrics. */
export class ServerClient extends Resource {
  /** Supported API versions (`GET /`), e.g. `["/1.0"]`. */
  async versions(): Promise<string[]> {
    return this.sync<string[]>("GET", "/");
  }

  /** Server environment, config, API extensions and the caller's auth state. */
  async info(opts?: ScopeOptions): Promise<Server> {
    return this.sync<Server>("GET", "/1.0", { params: this.scope(opts) });
  }

  async infoWithEtag(opts?: ScopeOptions): Promise<WithEtag<Server>> {
    return this.syncEtag<Server>("/1.0", { params: this.scope(opts) });
  }

  /** Replaces the server configuration. */
  async update(body: ServerPut, opts?: EtagOptions): Promise<void> {
    await this.request("PUT", "/1.0", this.etagOpts(opts, body));
  }

  /** Merges keys into the server configuration. */
  async patch(body: DeepPartial<ServerPut>, opts?: EtagOptions): Promise<void> {
    await this.request("PATCH", "/1.0", this.etagOpts(opts, body));
  }

  /** Sets (or, with `null`, unsets) server config keys. */
  async setConfig(
    config: Record<string, string | null>,
    opts?: ScopeOptions,
  ): Promise<void> {
    const { data, etag } = await this.infoWithEtag(opts);
    const next = { ...data.config };
    for (const [key, value] of Object.entries(config)) {
      if (value === null) delete next[key];
      else next[key] = value;
    }
    await this.update({ config: next }, { ...opts, etag });
  }

  /** Host hardware (CPU, memory, GPUs, NICs, disks, …). */
  async resources(opts?: ScopeOptions): Promise<Resources> {
    return this.sync<Resources>("GET", "/1.0/resources", {
      params: this.scope(opts),
    });
  }

  /** Prometheus metrics in text exposition format. */
  async metrics(opts?: ScopeOptions): Promise<string> {
    const { data } = await this.request<string>("GET", "/1.0/metrics", {
      params: this.scope(opts),
      responseType: "text",
    });
    return data;
  }

  /** Documentation of every config key (API extension: `metadata_configuration`). */
  async configMetadata(): Promise<MetadataConfiguration> {
    return this.sync<MetadataConfiguration>(
      "GET",
      "/1.0/metadata/configuration",
    );
  }

  /** Replaces the server's TLS certificate (PEM). */
  async updateCertificate(body: {
    certificate: string;
    key: string;
    ca?: string;
  }): Promise<void> {
    await this.request("PUT", "/1.0/server-certificate", { data: body });
  }
}
