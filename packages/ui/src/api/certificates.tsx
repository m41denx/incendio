import { handleResponse } from "util/helpers";
import type { LxdApiResponse } from "types/apiResponse";
import type { LxdCertificate } from "types/certificate";
import { ROOT_PATH } from "util/rootPath";

export const fetchCertificates = async (): Promise<LxdCertificate[]> => {
  return fetch(`${ROOT_PATH}/1.0/certificates?recursion=1`)
    .then(handleResponse)
    .then((data: LxdApiResponse<LxdCertificate[]>) => {
      return data.metadata;
    });
};

export const addCertificate = async (
  token: string,
  description?: string,
): Promise<void> => {
  // Incus uses the classic trust store (/1.0/certificates); it does not
  // implement LXD's fine-grained identity API (/1.0/auth/identities/tls).
  await fetch(`${ROOT_PATH}/1.0/certificates`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      type: "client",
      trust_token: token,
      // Ignored by servers without the certificate_description extension.
      ...(description ? { description } : {}),
    }),
  }).then(handleResponse);
};

// Trust a client certificate directly (no token): `certificate` is the base64
// DER body of the PEM. Used to trust the Kubernetes appliance's Incus identity.
export const trustClientCertificate = async (
  certificate: string,
  name: string,
  description?: string,
): Promise<void> => {
  await fetch(`${ROOT_PATH}/1.0/certificates`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      type: "client",
      certificate,
      name,
      restricted: false,
      ...(description ? { description } : {}),
    }),
  }).then(handleResponse);
};

// PATCH only the description (certificate_description extension); other fields
// are left untouched.
export const updateCertificateDescription = async (
  fingerprint: string,
  description: string,
): Promise<void> => {
  await fetch(`${ROOT_PATH}/1.0/certificates/${fingerprint}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ description }),
  }).then(handleResponse);
};

export const deleteCertificate = async (fingerprint: string): Promise<void> => {
  await fetch(`${ROOT_PATH}/1.0/certificates/${fingerprint}`, {
    method: "DELETE",
  }).then(handleResponse);
};
