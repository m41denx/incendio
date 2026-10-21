import { type FC, useState } from "react";
import { Button, CheckboxInput, Input, MainTable, Select } from "@canonical/react-components";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import PageLayout from "../../components/PageLayout";
import ConfirmAction from "../../components/ConfirmAction";
import EmptyList from "../../components/EmptyList";
import FormModal from "../../components/FormModal";
import { ErrorMessage, Loaded } from "../../components/Status";
import { request } from "../../api/client";
import { canAtRoot, useMe } from "../../api/hooks";
import { useGroups } from "../groups/GroupList";

export interface IdentityProvider {
  id: string;
  slug: string;
  name: string;
  issuer: string;
  clientId: string;
  scopes: string;
  groupsClaim: string;
  createUsers: boolean;
  enabled: boolean;
  callbackUrl: string;
  mappings: Array<{ id: string; claim: string; groupId: string; group: string }>;
  /** How many users have signed in through it. */
  users: number;
}

const LIST = "/api/v1/identity-providers";
const useProviders = () => useQuery({ queryKey: ["identity-providers"], queryFn: () => request<{ callbackUrl: string; providers: IdentityProvider[] }>("GET", LIST) });

/**
 * Platform › Identity providers (permissions phase 5): upstream OpenID
 * Connect providers people sign in with, and which IncusCloud groups the
 * values of their groups claim put them in.
 */
const IdentityProviderList: FC = () => {
  const { data: me } = useMe();
  const manage = canAtRoot(me, "platform.settings");
  const qc = useQueryClient();
  const providers = useProviders();
  const [editing, setEditing] = useState<IdentityProvider | "new" | null>(null);
  const [mapping, setMapping] = useState<IdentityProvider | null>(null);
  const [error, setError] = useState<unknown>(null);
  const changed = () => Promise.all([qc.invalidateQueries({ queryKey: ["identity-providers"] }), qc.invalidateQueries({ queryKey: ["groups"] }), qc.invalidateQueries({ queryKey: ["acl"] })]);

  return (
    <PageLayout
      title="Identity providers"
      controls={
        manage ? (
          <Button appearance="positive" onClick={() => setEditing("new")}>
            Add identity provider
          </Button>
        ) : undefined
      }
    >
      <p className="u-text--muted">
        People can sign in with an OpenID Connect provider (Keycloak, Authentik, Entra ID, Google…) as well as with a password. Each time they do, the values of the provider's groups
        claim decide which IncusCloud groups they are in, by the mappings below. Groups added by hand stay.
      </p>
      <Loaded query={providers}>
        {({ callbackUrl, providers: list }) => (
          <>
            <p>
              Register IncusCloud at the provider as a confidential web client with this redirect URI: <code>{callbackUrl}</code>
            </p>
            {error ? <ErrorMessage error={error} title="Not done" /> : null}
            {list.length === 0 ? (
              <EmptyList icon="user" title="No identity providers">
                Everyone signs in with an IncusCloud password.
              </EmptyList>
            ) : (
              <MainTable
                headers={[{ content: "Name" }, { content: "Issuer" }, { content: "Users" }, { content: "Group mappings" }, { content: "", className: "u-align--right ic-col-actions" }]}
                rows={list.map((p) => ({
                  key: p.id,
                  columns: [
                    {
                      content: (
                        <>
                          {p.name}
                          {p.enabled ? null : <span className="u-text--muted"> · disabled</span>}
                          <div className="u-text--muted">{p.slug}</div>
                        </>
                      ),
                    },
                    { content: <code>{p.issuer}</code> },
                    { content: p.users },
                    {
                      content: p.mappings.length ? (
                        <ul className="p-list u-no-margin--bottom">
                          {p.mappings.map((m) => (
                            <li key={m.id} className="p-list__item">
                              <code>{m.claim}</code> → {m.group}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <span className="u-text--muted">None</span>
                      ),
                    },
                    {
                      className: "u-align--right ic-col-actions",
                      content: manage ? (
                        <>
                          <Button className="u-no-margin--bottom" onClick={() => setMapping(p)}>
                            Mappings
                          </Button>
                          <Button className="u-no-margin--bottom" onClick={() => setEditing(p)}>
                            Edit
                          </Button>
                          <ConfirmAction
                            label="Delete"
                            title="Delete identity provider"
                            onConfirm={async () => {
                              await request("DELETE", `${LIST}/${p.id}`);
                              await changed();
                            }}
                            onError={setError}
                            className="u-no-margin--bottom"
                          >
                            Delete {p.name}? Its users stay, but can no longer sign in with it, and leave the groups its mappings put them in.
                          </ConfirmAction>
                        </>
                      ) : null,
                    },
                  ],
                }))}
              />
            )}
          </>
        )}
      </Loaded>
      {editing ? <ProviderForm provider={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={changed} /> : null}
      {mapping ? <MappingsForm provider={mapping} onClose={() => setMapping(null)} onSaved={changed} /> : null}
    </PageLayout>
  );
};

const ProviderForm: FC<{ provider: IdentityProvider | null; onClose: () => void; onSaved: () => Promise<unknown> }> = ({ provider, onClose, onSaved }) => {
  const [f, setF] = useState({
    name: provider?.name ?? "",
    slug: provider?.slug ?? "",
    issuer: provider?.issuer ?? "",
    clientId: provider?.clientId ?? "",
    clientSecret: "",
    scopes: provider?.scopes ?? "openid email profile",
    groupsClaim: provider?.groupsClaim ?? "groups",
    createUsers: provider?.createUsers ?? true,
    enabled: provider?.enabled ?? true,
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const ready = f.name && f.issuer && f.clientId && (provider || (f.slug && f.clientSecret));
  return (
    <FormModal
      title={provider ? `Edit ${provider.name}` : "Add identity provider"}
      submitLabel={provider ? "Save" : "Add"}
      submitDisabled={!ready}
      onClose={onClose}
      onSubmit={async () => {
        const { slug, clientSecret, ...rest } = f;
        if (provider) await request("PATCH", `${LIST}/${provider.id}`, { ...rest, ...(clientSecret ? { clientSecret } : {}) });
        else await request("POST", LIST, { ...rest, slug, clientSecret });
        await onSaved();
      }}
    >
      <Input id="idp-name" type="text" label="Name" help={`On the sign-in page: "Sign in with ${f.name || "…"}".`} value={f.name} onChange={set("name")} required />
      {provider ? null : <Input id="idp-slug" type="text" label="Short name" help="In sign-in links: lower case letters, digits and dashes." value={f.slug} onChange={set("slug")} required />}
      <Input id="idp-issuer" type="url" label="Issuer" help="IncusCloud reads its discovery document (/.well-known/openid-configuration) when you save." value={f.issuer} onChange={set("issuer")} required />
      <Input id="idp-client-id" type="text" label="Client ID" value={f.clientId} onChange={set("clientId")} required />
      <Input
        id="idp-client-secret"
        type="password"
        autoComplete="new-password"
        label="Client secret"
        help={provider ? "Leave empty to keep the current one." : undefined}
        value={f.clientSecret}
        onChange={set("clientSecret")}
        required={!provider}
      />
      <Input id="idp-scopes" type="text" label="Scopes" help="Some providers need a scope (often groups) to send the groups claim." value={f.scopes} onChange={set("scopes")} />
      <Input id="idp-groups-claim" type="text" label="Groups claim" help="The claim, in the ID token or userinfo, that lists the user's groups." value={f.groupsClaim} onChange={set("groupsClaim")} />
      <CheckboxInput
        id="idp-create-users"
        label="Create an account for anyone who signs in for the first time"
        checked={f.createUsers}
        onChange={() => setF({ ...f, createUsers: !f.createUsers })}
      />
      <p className="p-form-help-text">Otherwise only people who already have an account (with the same verified email) can sign in with it.</p>
      <CheckboxInput id="idp-enabled" label="Show on the sign-in page" checked={f.enabled} onChange={() => setF({ ...f, enabled: !f.enabled })} />
    </FormModal>
  );
};

const MappingsForm: FC<{ provider: IdentityProvider; onClose: () => void; onSaved: () => Promise<unknown> }> = ({ provider, onClose, onSaved }) => {
  const groups = useGroups();
  const [rows, setRows] = useState(provider.mappings.map((m) => ({ claim: m.claim, groupId: m.groupId })));
  const update = (n: number, patch: Partial<(typeof rows)[number]>) => setRows(rows.map((r, i) => (i === n ? { ...r, ...patch } : r)));
  const options = [{ value: "", label: "Choose a group…", disabled: true }, ...(groups.data ?? []).map((g) => ({ value: g.id, label: g.name }))];
  return (
    <FormModal
      title={`Group mappings for ${provider.name}`}
      submitLabel="Save"
      submitDisabled={rows.some((r) => !r.claim.trim() || !r.groupId)}
      onClose={onClose}
      onSubmit={async () => {
        await request("PUT", `${LIST}/${provider.id}/mappings`, { mappings: rows.map((r) => ({ claim: r.claim.trim(), groupId: r.groupId })) });
        await onSaved();
      }}
    >
      <p className="u-text--muted">
        Someone whose <code>{provider.groupsClaim}</code> claim holds a value below is in its group. Saving applies the mappings at once to everyone who has signed in with{" "}
        {provider.name}, from the groups they brought last time.
      </p>
      {groups.error ? <ErrorMessage error={groups.error} /> : null}
      {rows.length === 0 ? <p>No mappings: {provider.name} puts nobody in a group.</p> : null}
      {rows.map((r, n) => (
        <div key={n} className="ic-actions">
          <Input id={`map-claim-${n}`} type="text" label="Claim value" value={r.claim} onChange={(e) => update(n, { claim: e.target.value })} />
          <Select id={`map-group-${n}`} label="Group" options={options} value={r.groupId} onChange={(e) => update(n, { groupId: e.target.value })} />
          <Button type="button" appearance="base" onClick={() => setRows(rows.filter((_, i) => i !== n))} aria-label={`Remove mapping ${n + 1}`}>
            Remove
          </Button>
        </div>
      ))}
      <Button type="button" onClick={() => setRows([...rows, { claim: "", groupId: "" }])}>
        Add mapping
      </Button>
      {groups.data?.length === 0 ? <p className="u-text--muted">There are no groups yet: create them on the Groups page first.</p> : null}
    </FormModal>
  );
};

export default IdentityProviderList;
