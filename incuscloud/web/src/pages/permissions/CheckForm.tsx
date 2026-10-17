import { type FC, type FormEvent, useState } from "react";
import {
  Button,
  Form,
  Input,
  MainTable,
  Select,
} from "@canonical/react-components";
import { request } from "../../api/client";
import type { AclEntry } from "../../api/types";
import { ErrorMessage } from "../../components/Status";
import { SOURCE_LABEL, useRoleName, useSubjects } from "./usePermissions";

interface Result {
  privileges: string[];
  decidedBy: AclEntry[];
}

/** What a subject may do on a path, and which entries decided it. */
const CheckForm: FC<{ path?: string }> = ({ path: initial = "/" }) => {
  const subjects = useSubjects();
  const roleName = useRoleName();
  const [subject, setSubject] = useState("");
  const [path, setPath] = useState(initial);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<unknown>(null);
  const check = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      setResult(
        await request<Result>(
          "GET",
          `/api/v1/acl/check?${new URLSearchParams({ subject, path })}`,
        ),
      );
    } catch (err) {
      setResult(null);
      setError(err);
    }
  };
  return (
    <>
      <Form onSubmit={check}>
        <Select
          id="check-subject"
          label="Subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          options={[
            {
              value: "",
              label: "Choose a user or service account",
              disabled: true,
            },
            ...subjects,
          ]}
        />
        <Input
          id="check-path"
          type="text"
          label="Path"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          help="/, /platform, /clusters/<name>, /tenants/<slug>, …"
        />
        <Button
          type="submit"
          appearance="positive"
          disabled={!subject || !path}
        >
          Check
        </Button>
      </Form>
      {error ? <ErrorMessage error={error} /> : null}
      {result ? (
        <>
          <h3 className="p-heading--5">Privileges</h3>
          {result.privileges.length ? (
            <p className="ic-privileges">
              {result.privileges.map((p) => (
                <code key={p}>{p}</code>
              ))}
            </p>
          ) : (
            <p>None: nothing is allowed here.</p>
          )}
          <h3 className="p-heading--5">Decided by</h3>
          {result.decidedBy.length ? (
            <section aria-label="Deciding entries">
              <MainTable
                headers={[
                  { content: "Path" },
                  { content: "Subject" },
                  { content: "Role" },
                  { content: "Source" },
                ]}
                rows={result.decidedBy.map((e) => ({
                  key: e.id,
                  columns: [
                    { content: <code className="ic-nowrap">{e.path}</code> },
                    { content: e.subject.name },
                    { content: roleName(e.role) },
                    { content: SOURCE_LABEL[e.source] },
                  ],
                }))}
              />
            </section>
          ) : (
            <p>No entry applies.</p>
          )}
        </>
      ) : null}
    </>
  );
};

export default CheckForm;
