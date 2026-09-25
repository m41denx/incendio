import type { FC } from "react";
import { Button, Input, Notification } from "@canonical/react-components";
import type { K8sMetalLBHint } from "pages/kubernetes/useK8sClusters";

interface Props {
  id: string;
  value: string;
  onChange: (value: string) => void;
  hint?: K8sMetalLBHint;
  error?: string | null;
}

// Address pool for MetalLB: free addresses on the Incus network the nodes
// use, which the speaker announces in L2 mode.
const MetalLBAddressInput: FC<Props> = ({
  id,
  value,
  onChange,
  hint,
  error,
}) => (
  <>
    <Input
      id={id}
      type="text"
      label="Address range"
      value={value}
      placeholder={hint?.range ?? "10.0.0.200-10.0.0.220"}
      error={error ?? undefined}
      help={
        <>
          IPv4 ranges or CIDRs, comma separated, that are not used by anything
          else
          {hint ? (
            <>
              {" "}
              on network <code>{hint.network}</code> ({hint.subnet})
            </>
          ) : null}
          . Services of type LoadBalancer get their external IP from here; they
          are reachable from the Incus host and other instances on that network.
          {hint?.range && hint.range !== value ? (
            <>
              {" "}
              <Button
                appearance="link"
                type="button"
                className="u-no-margin--bottom"
                onClick={() => {
                  onChange(hint.range ?? "");
                }}
              >
                Use {hint.range}
              </Button>
            </>
          ) : null}
        </>
      }
      onChange={(e) => {
        onChange(e.target.value);
      }}
    />
    {hint?.warning ? (
      <Notification severity="caution" title="Check the network">
        {hint.warning}
      </Notification>
    ) : null}
  </>
);

export default MetalLBAddressInput;
