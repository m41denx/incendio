import type { FC } from "react";
import { Link } from "react-router-dom";
import { ThemeSwitcher } from "@canonical/react-components";
import { useQuery } from "@tanstack/react-query";
import PageLayout from "../components/PageLayout";
import KeyValues from "../components/KeyValues";
import { Loaded } from "../components/Status";
import { request } from "../api/client";
import { clusterApiUrl, useMe } from "../api/hooks";
import type { Cluster } from "../api/types";
import Section from "../components/Section";

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
            <Section title="General" id="profile-general">
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
            </Section>

            <Section title="Appearance" id="profile-appearance">
              <p>Every page of the console, Incendio's included. System follows your device.</p>
              <ThemeSwitcher />
            </Section>

            <Section title="Use from the command line" id="profile-cli">
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
                  <p className="u-text--muted">No clusters are available to you yet.</p>
                )
              }
            </Loaded>
            </Section>

            <Section title="Consoles" id="profile-consoles">
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
                  <p className="u-text--muted">No consoles are available to you yet.</p>
                )
              }
            </Loaded>
            </Section>
          </PageLayout>
        );
      }}
    </Loaded>
  );
};

export default Profile;
