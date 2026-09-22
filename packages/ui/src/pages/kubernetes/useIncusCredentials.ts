import { useEffect, useState } from "react";
import { useNotify } from "@canonical/react-components";
import { useSettings } from "context/useSettings";
import type { IncusClientCredential } from "util/k8s/capn";

// Shared Incus infrastructure-credential state for the Kubernetes pages. Both
// the cluster-create Secret generator and the management-appliance deploy need
// the same Incus server URL + certificates, so the logic lives here instead of
// being duplicated. Server URL and server certificate are seeded from the
// loaded Incus settings; the client certificate/key are generated in a worker.
export interface IncusCredentialsState {
  serverUrl: string;
  setServerUrl: (value: string) => void;
  project: string;
  setProject: (value: string) => void;
  serverCrt: string;
  setServerCrt: (value: string) => void;
  clientCrt: string;
  setClientCrt: (value: string) => void;
  clientKey: string;
  setClientKey: (value: string) => void;
  isGenerating: boolean;
  generateCredential: () => void;
}

export const useIncusCredentials = (): IncusCredentialsState => {
  const notify = useNotify();
  const { data: settings } = useSettings();
  const [serverUrl, setServerUrl] = useState("");
  const [project, setProject] = useState("default");
  const [serverCrt, setServerCrt] = useState("");
  const [clientCrt, setClientCrt] = useState("");
  const [clientKey, setClientKey] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    const environment = settings?.environment;
    if (!environment) {
      return;
    }
    const address = environment.addresses?.[0];
    if (address) {
      setServerUrl((prev) => prev || `https://${address}`);
    }
    if (environment.certificate) {
      setServerCrt((prev) => prev || environment.certificate || "");
    }
  }, [settings]);

  const generateCredential = () => {
    setIsGenerating(true);
    const worker = new Worker(
      new URL("../../util/generateK8sCredential?worker", import.meta.url),
      { type: "module" },
    );
    worker.onmessage = (event: MessageEvent<IncusClientCredential>) => {
      setClientCrt(event.data.crt);
      setClientKey(event.data.key);
      setIsGenerating(false);
      worker.terminate();
      notify.success(
        "Client certificate and key generated. Trust the certificate on your Incus server before applying the Secret.",
      );
    };
    worker.onerror = (error) => {
      setIsGenerating(false);
      worker.terminate();
      notify.failure(
        "Failed to generate client certificate",
        new Error(error.message),
      );
    };
    worker.postMessage("");
  };

  return {
    serverUrl,
    setServerUrl,
    project,
    setProject,
    serverCrt,
    setServerCrt,
    clientCrt,
    setClientCrt,
    clientKey,
    setClientKey,
    isGenerating,
    generateCredential,
  };
};
