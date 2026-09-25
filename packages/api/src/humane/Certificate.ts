import type { IncusClient } from "./Client";
import type { Certificate as CertificateT } from "../api/types/generated";

/** Instance of a Humane Incus trusted certificate. */
export class Certificate {
  private readonly client: IncusClient;
  private $data: CertificateT;

  constructor(client: IncusClient, data: CertificateT) {
    this.client = client;
    this.$data = data;
  }

  get data() {
    return this.$data;
  }
  get fingerprint() {
    return this.$data.fingerprint;
  }
  get name() {
    return this.$data.name;
  }
  /** `client`, `server` or `metrics`. */
  get type() {
    return this.$data.type;
  }
  get description() {
    return this.$data.description;
  }
  /** Whether access is limited to `projects`. */
  get restricted() {
    return this.$data.restricted;
  }
  get projects() {
    return this.$data.projects ?? [];
  }
  /** PEM certificate. */
  get certificate() {
    return this.$data.certificate;
  }

  private get api() {
    return this.client.$api.certificates;
  }

  async refresh(): Promise<this> {
    this.$data = await this.api.get(this.fingerprint);
    return this;
  }

  /** Restricts the certificate to the given projects (or lifts it with `null`). */
  async restrictTo(projects: string[] | null): Promise<void> {
    await this.api.patch(this.fingerprint, {
      restricted: projects !== null,
      projects: projects ?? [],
    });
    await this.refresh();
  }

  async rename(name: string): Promise<void> {
    await this.api.patch(this.fingerprint, { name });
    await this.refresh();
  }

  async setDescription(description: string): Promise<void> {
    await this.api.patch(this.fingerprint, { description });
    await this.refresh();
  }

  delete(): Promise<void> {
    return this.api.delete(this.fingerprint);
  }
}
