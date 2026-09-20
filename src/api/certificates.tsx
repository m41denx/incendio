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

export const addCertificate = async (token: string): Promise<void> => {
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
    }),
  }).then(handleResponse);
};

export const deleteCertificate = async (fingerprint: string): Promise<void> => {
  await fetch(`${ROOT_PATH}/1.0/certificates/${fingerprint}`, {
    method: "DELETE",
  }).then(handleResponse);
};
