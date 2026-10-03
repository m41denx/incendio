import { useState, type FC } from "react";
import {
  ActionButton,
  Col,
  CustomLayout,
  Form,
  Input,
  Notification,
  Row,
  Select,
} from "@canonical/react-components";
import NotificationRow from "components/NotificationRow";
import PageHeader from "components/PageHeader";
import HelpLink from "components/HelpLink";
import {
  checkTuple,
  describeOpenFgaError,
  type OpenFgaSettings,
} from "api/openfga";
import OpenFgaGate from "pages/authorization/OpenFgaGate";
import {
  useOpenFgaClient,
  type OpenFgaData,
} from "pages/authorization/useOpenFga";
import {
  objectName,
  SERVER_OBJECT,
  subjectUser,
  typeLabel,
  type FgaTuple,
} from "util/openfga";

interface Result {
  tuple: FgaTuple;
  name: string;
  allowed?: boolean;
  error?: string;
}

const CheckForm: FC<{ data: OpenFgaData; settings: OpenFgaSettings }> = ({
  data,
  settings,
}) => {
  const client = useOpenFgaClient(settings);
  const types = Object.keys(data.objects).sort((a, b) =>
    a === "server" ? -1 : b === "server" ? 1 : a.localeCompare(b),
  );
  const [name, setName] = useState("");
  const [type, setType] = useState(
    types.includes("instance") ? "instance" : "server",
  );
  const [object, setObject] = useState(
    data.objects[type]?.[0] ?? SERVER_OBJECT,
  );
  const [relation, setRelation] = useState(
    data.relations[type]?.includes("can_view")
      ? "can_view"
      : (data.relations[type]?.[0] ?? ""),
  );
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const changeType = (next: string) => {
    setType(next);
    setObject(data.objects[next]?.[0] ?? "");
    const relations = data.relations[next] ?? [];
    setRelation(
      relations.includes("can_view") ? "can_view" : (relations[0] ?? ""),
    );
  };

  const trimmed = name.trim();

  const check = () => {
    if (!client) {
      return;
    }
    const tuple = {
      user: subjectUser({ kind: "user", name: trimmed }),
      relation,
      object,
    };
    setChecking(true);
    checkTuple(client, tuple)
      .then((allowed) => {
        setResult({ tuple, name: trimmed, allowed });
      })
      .catch((e: unknown) => {
        setResult({ tuple, name: trimmed, error: describeOpenFgaError(e) });
      })
      .finally(() => {
        setChecking(false);
      });
  };

  return (
    <Row>
      <Col size={8}>
        <p className="u-text--muted">
          Ask OpenFGA what Incus asks it on every request from a user routed to
          OpenFGA. The answer counts every grant, group and role inherited from
          the server or project.
        </p>
        <Form
          onSubmit={(e) => {
            e.preventDefault();
            check();
          }}
        >
          <Input
            type="text"
            label="User name"
            value={name}
            list="openfga-check-users"
            onChange={(e) => {
              setName(e.target.value);
            }}
            autoComplete="off"
            takeFocus
          />
          <datalist id="openfga-check-users">
            {data.users.map((u) => (
              <option key={u} value={u} />
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
          />
          <Select
            label="Permission"
            value={relation}
            options={(data.relations[type] ?? []).map((r) => ({
              label: r,
              value: r,
            }))}
            onChange={(e) => {
              setRelation(e.target.value);
            }}
          />
          <ActionButton
            appearance="positive"
            type="submit"
            loading={checking}
            disabled={!trimmed || !object || !relation || checking}
          >
            Check
          </ActionButton>
        </Form>
        {result && (
          <Notification
            severity={
              result.error
                ? "negative"
                : result.allowed
                  ? "positive"
                  : "caution"
            }
            title={
              result.error
                ? "Check failed"
                : result.allowed
                  ? "Allowed"
                  : "Denied"
            }
          >
            {result.error ?? (
              <>
                <strong>{result.name}</strong>{" "}
                {result.allowed ? "has" : "does not have"}{" "}
                <code>{result.tuple.relation}</code> on{" "}
                <strong>{objectName(result.tuple.object)}</strong>. This only
                applies while their client class is routed to OpenFGA.
              </>
            )}
          </Notification>
        )}
      </Col>
    </Row>
  );
};

const AuthorizationCheck: FC = () => (
  <CustomLayout
    header={
      <PageHeader>
        <PageHeader.Left>
          <PageHeader.Title>
            <HelpLink
              docPath="/authorization/"
              title="Learn more about authorization"
            >
              Check access
            </HelpLink>
          </PageHeader.Title>
        </PageHeader.Left>
      </PageHeader>
    }
  >
    <NotificationRow />
    <OpenFgaGate>
      {(data, settings) => <CheckForm data={data} settings={settings} />}
    </OpenFgaGate>
  </CustomLayout>
);

export default AuthorizationCheck;
