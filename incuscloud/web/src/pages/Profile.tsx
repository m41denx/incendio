import type { FC } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import PageLayout from "../components/PageLayout";
import KeyValues from "../components/KeyValues";
import { Loaded } from "../components/Status";
import { request } from "../api/client";
import { clusterApiUrl, useMe } from "../api/hooks";
import type { Cluster } from "../api/types";

const platformRoleLabel = (r: string | null) => (r ? r[0]!.toUpperCase() + r.slice(1) : "None");

const Profile: FC = () => {
  const me = useMe();
  const clusters = useQuery({ queryKey: ["clusters"], queryFn: () => request<Cluster[]>("GET", "/api/v1/clusters") });
  return (
    <Loaded query={me}>
      {(p) => {
        const usable = (clusters.data ?? []).filter((c) => c.status !== "disabled");
        return (
          <PageLayout title={p.name}>
            <KeyValues
              items={[
                ["Email", p.email ?? "—"],
                ["Platform role", platformRoleLabel(p.platformRole)],
                [
                  "Tenants",
                  p.tenants.length ? (
                    <ul className="p-list">
                      {p.tenants.map((t) => (
                        <li key={t.id} className="p-list__item">
                          <Link to={`/tenants/${t.id}`}>{`${t.name} (${t.role})`}</Link>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    "None"
                  ),
                ],
              ]}
            />

            <h2 className="p-heading--4">Use from the command line</h2>
            <p>The CLI opens a browser sign-in on first use, and tokens refresh themselves.</p>
            <Loaded query={clusters}>
              {() =>
                usable.length ? (
                  usable.map((c) => (
                    <div key={c.id} className="p-code-snippet">
                      <pre className="p-code-snippet__block--icon">
                        <code>{`incus remote add ${c.name} ${clusterApiUrl(p, c.name)} --auth-type=oidc`}</code>
                      </pre>
                    </div>
                  ))
                ) : (
                  <p className="ic-muted">No clusters are available to you yet.</p>
                )
              }
            </Loaded>

            <h2 className="p-heading--4">Consoles</h2>
            <Loaded query={clusters}>
              {() =>
                usable.length ? (
                  <ul className="p-list">
                    {usable.map((c) => (
                      <li key={c.id} className="p-list__item">
                        {/* Served by the server, not this app, so no router link. */}
                        <a href={`/clusters/${c.name}/ui/`}>{`Open ${c.name} console`}</a>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="ic-muted">No consoles are available to you yet.</p>
                )
              }
            </Loaded>
          </PageLayout>
        );
      }}
    </Loaded>
  );
};

export default Profile;
