import type { FC, ReactNode } from "react";
import { Button, CodeSnippet, Modal } from "@canonical/react-components";
import KeyValues from "../../components/KeyValues";
import type { ServiceAccountSecret } from "../../api/types";

/** Copies to the clipboard where the browser offers it; otherwise the value stays on screen to select by hand. */
const copy = (text: string) => {
  navigator.clipboard?.writeText(text).catch(() => {});
};

const CopyButton: FC<{ label: string; value: string }> = ({ label, value }) => (
  <Button type="button" small aria-label={`Copy ${label}`} onClick={() => copy(value)}>
    Copy
  </Button>
);

const withCopy = (value: ReactNode, label: string, text: string): ReactNode => (
  <>
    {value} <CopyButton label={label} value={text} />
  </>
);

/** The one time a secret is shown: copy it, then Done. Held in the caller's state only. */
const SecretOnce: FC<{ secret: ServiceAccountSecret; onDone: () => void }> = ({ secret, onDone }) => (
  <Modal
    title="Save the secret now"
    close={onDone}
    closeOnOutsideClick={false}
    buttonRow={
      <Button appearance="positive" type="button" onClick={onDone}>
        Done
      </Button>
    }
  >
    <p>The client secret is shown only once and cannot be retrieved later. To get a new one, rotate the secret from the list.</p>
    <KeyValues
      items={[
        ["Client ID", withCopy(<span className="mono-font">{secret.clientId}</span>, "client ID", secret.clientId)],
        ["Client secret", withCopy(<span className="mono-font ic-wrap">{secret.clientSecret}</span>, "client secret", secret.clientSecret)],
        ["Token URL", withCopy(secret.tokenUrl, "token URL", secret.tokenUrl)],
      ]}
    />
    <p>Get an access token with:</p>
    <CodeSnippet
      blocks={[
        {
          code: `curl -s -u '${secret.clientId}:${secret.clientSecret}' -d grant_type=client_credentials -d audience=incuscloud ${secret.tokenUrl}`,
          wrapLines: true,
        },
      ]}
    />
  </Modal>
);

export default SecretOnce;
