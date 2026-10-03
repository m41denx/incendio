import { useState, type FC } from "react";
import {
  ActionButton,
  Button,
  Input,
  Modal,
  Select,
  useNotify,
  useToastNotification,
} from "@canonical/react-components";
import { describeOpenFgaError, type OpenFgaSettings } from "api/openfga";
import {
  useWriteTuples,
  type OpenFgaData,
} from "pages/authorization/useOpenFga";
import {
  objectName,
  ROLE_HELP,
  SERVER_OBJECT,
  subjectUser,
  typeLabel,
  type SubjectKind,
} from "util/openfga";

interface Props {
  data: OpenFgaData;
  settings: OpenFgaSettings;
  close: () => void;
}

const GrantModal: FC<Props> = ({ data, settings, close }) => {
  const notify = useNotify();
  const toastNotify = useToastNotification();
  const write = useWriteTuples(settings);

  const types = Object.keys(data.grantable)
    .filter((t) => t !== "group" && (data.objects[t]?.length ?? 0) > 0)
    .sort((a, b) =>
      a === "server" ? -1 : b === "server" ? 1 : a.localeCompare(b),
    );

  const [kind, setKind] = useState<SubjectKind>("user");
  const [name, setName] = useState("");
  const [type, setType] = useState(
    types.includes("project") ? "project" : "server",
  );
  const [object, setObject] = useState(
    data.objects[type]?.[0] ?? SERVER_OBJECT,
  );
  const [relation, setRelation] = useState(data.grantable[type]?.[0] ?? "");

  const changeType = (next: string) => {
    setType(next);
    setObject(data.objects[next]?.[0] ?? "");
    setRelation(data.grantable[next]?.[0] ?? "");
  };

  const trimmed = name.trim();
  const user = subjectUser({ kind, name: trimmed });
  const exists = data.grants.some(
    (g) => g.user === user && g.relation === relation && g.object === object,
  );
  const invalid = !trimmed || /[\s#]/.test(trimmed) || !object || !relation;

  const submit = () => {
    write.mutate(
      { writes: [{ user, relation, object }] },
      {
        onSuccess: () => {
          toastNotify.success(
            `Granted ${relation} on ${objectName(object)} to ${kind} ${trimmed}.`,
          );
          close();
        },
        onError: (e) => {
          notify.failure(
            "Granting access failed",
            new Error(describeOpenFgaError(e)),
          );
        },
      },
    );
  };

  const suggestions = kind === "user" ? data.users : data.groups;

  return (
    <Modal
      close={close}
      title="Grant access"
      buttonRow={
        <>
          <Button
            appearance="base"
            className="u-no-margin--bottom"
            onClick={close}
            type="button"
          >
            Cancel
          </Button>
          <ActionButton
            appearance="positive"
            className="u-no-margin--bottom"
            loading={write.isPending}
            disabled={invalid || exists || write.isPending}
            onClick={submit}
            type="button"
          >
            Grant
          </ActionButton>
        </>
      }
    >
      <Select
        label="Grant to"
        value={kind}
        options={[
          { label: "User", value: "user" },
          { label: "Group", value: "group" },
        ]}
        onChange={(e) => {
          setKind(e.target.value as SubjectKind);
        }}
      />
      <Input
        type="text"
        label={kind === "user" ? "User name" : "Group name"}
        help={
          kind === "user"
            ? "As Incus sees it: the OIDC claim set in oidc.claim (else email, else sub), or the TLS certificate's name or fingerprint (authorization.openfga.tls.identifier)."
            : "Members are managed on the Groups page."
        }
        value={name}
        list="openfga-subjects"
        onChange={(e) => {
          setName(e.target.value);
        }}
        error={
          trimmed && /[\s#]/.test(trimmed)
            ? "Names cannot contain spaces or #"
            : undefined
        }
        autoComplete="off"
        takeFocus
      />
      <datalist id="openfga-subjects">
        {suggestions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <Select
        label="Resource type"
        value={type}
        options={types.map((t) => ({ label: typeLabel(t), value: t }))}
        onChange={(e) => {
          changeType(e.target.value);
        }}
      />
      <Select
        label="Resource"
        value={object}
        options={(data.objects[type] ?? []).map((o) => ({
          label: objectName(o),
          value: o,
        }))}
        onChange={(e) => {
          setObject(e.target.value);
        }}
        help={
          type === "server"
            ? "Roles on the server apply to every project."
            : type === "project"
              ? "Roles on a project apply to everything in it."
              : undefined
        }
      />
      <Select
        label="Role or permission"
        value={relation}
        options={(data.grantable[type] ?? []).map((r) => ({
          label: r,
          value: r,
        }))}
        onChange={(e) => {
          setRelation(e.target.value);
        }}
        help={
          exists
            ? "This grant already exists."
            : (ROLE_HELP[relation] ?? undefined)
        }
      />
    </Modal>
  );
};

export default GrantModal;
