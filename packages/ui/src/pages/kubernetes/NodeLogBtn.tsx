import { useEffect, useRef, type FC } from "react";
import {
  Button,
  Icon,
  Modal,
  Spinner,
  usePortal,
} from "@canonical/react-components";
import { useQuery } from "@tanstack/react-query";
import { readInstanceFile } from "util/k8s/instanceFiles";

// cloud-init runs the node's kubeadm bootstrap; its output is the node-side
// half of the provisioning log (the controllers' half is Cluster activity).
const CLOUD_INIT_LOG = "/var/log/cloud-init-output.log";
const TAIL_LINES = 400;
const POLL_MS = 3_000;

interface ModalProps {
  project: string;
  instance: string;
  onClose: () => void;
}

const NodeLogModal: FC<ModalProps> = ({ project, instance, onClose }) => {
  const { data, error, isLoading } = useQuery({
    queryKey: ["k8s", "node-log", project, instance],
    queryFn: async () => {
      const raw = await readInstanceFile(project, instance, CLOUD_INIT_LOG);
      return raw === null
        ? null
        : raw.trimEnd().split("\n").slice(-TAIL_LINES).join("\n");
    },
    refetchInterval: POLL_MS,
    retry: false,
  });
  const preRef = useRef<HTMLPreElement>(null);
  const followRef = useRef(true);

  useEffect(() => {
    const pre = preRef.current;
    if (pre && followRef.current) pre.scrollTop = pre.scrollHeight;
  }, [data]);

  return (
    <Modal
      close={onClose}
      title={`Bootstrap log: ${instance}`}
      className="k8s-node-log-modal"
    >
      <p className="u-text--muted">
        <code>{CLOUD_INIT_LOG}</code>, last {TAIL_LINES} lines, refreshed every{" "}
        {POLL_MS / 1000}s.
      </p>
      {isLoading ? <Spinner text="Reading log..." /> : null}
      {error ? <p>Reading the log failed: {error.message}</p> : null}
      {data === null ? (
        <p className="u-text--muted">
          The log does not exist yet: cloud-init has not started.
        </p>
      ) : null}
      {data ? (
        <pre
          ref={preRef}
          className="p-code-snippet__block k8s-node-log"
          onScroll={(e) => {
            const el = e.currentTarget;
            followRef.current =
              el.scrollHeight - el.scrollTop - el.clientHeight < 24;
          }}
        >
          {data}
        </pre>
      ) : null}
    </Modal>
  );
};

interface Props {
  project: string;
  instance: string;
}

const NodeLogBtn: FC<Props> = ({ project, instance }) => {
  const { openPortal, closePortal, isOpen, Portal } = usePortal({
    programmaticallyOpen: true,
  });
  return (
    <>
      <Button
        appearance="base"
        dense
        hasIcon
        onClick={openPortal}
        title="Bootstrap log"
        aria-label={`Bootstrap log of ${instance}`}
      >
        <Icon name="file" />
      </Button>
      {isOpen && (
        <Portal>
          <NodeLogModal
            project={project}
            instance={instance}
            onClose={closePortal}
          />
        </Portal>
      )}
    </>
  );
};

export default NodeLogBtn;
