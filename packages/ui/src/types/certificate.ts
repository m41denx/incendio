export interface LxdCertificate {
  name: string;
  type: string;
  fingerprint: string;
  restricted: boolean;
  projects: string[];
  certificate?: string;
  // API extension: certificate_description.
  description?: string;
}
