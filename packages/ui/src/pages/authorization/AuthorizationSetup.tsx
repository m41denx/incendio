import { useEffect, useState, type FC } from "react";
import {
  ActionButton,
  Button,
  Col,
  CustomLayout,
  Form,
  Input,
  MainTable,
  Notification,
  Row,
  Select,
  useNotify,
  useToastNotification,
} from "@canonical/react-components";
import { useQueryClient } from "@tanstack/react-query";
import NotificationRow from "components/NotificationRow";
import PageHeader from "components/PageHeader";
import HelpLink from "components/HelpLink";
import { updateSettings } from "api/server";
import {
  createOpenFgaClient,
  describeOpenFgaError,
  fetchLatestModel,
  fetchStoreName,
} from "api/openfga";
import { useSupportedFeatures } from "context/useSupportedFeatures";
import {
  BROWSER_URL_KEY,
  useOpenFgaKeys,
} from "pages/authorization/useOpenFga";
import { queryKeys } from "util/queryKeys";
import { AUTH_METHOD } from "util/authentication";
import { CLIENT_ROUTES, effectiveRoute, type ClientRoute } from "util/openfga";

const routeKey = (route: ClientRoute) => `authorization.client.${route.key}`;

type Form = Record<string, string>;

interface TestResult {
  ok: boolean;
  message: string;
}

const AuthorizationSetup: FC = () => {
  const notify = useNotify();
  const toastNotify = useToastNotification();
  const queryClient = useQueryClient();
  const { settings, isSettingsLoading, hasAuthorizationClientRouting } =
    useSupportedFeatures();
  const keys = useOpenFgaKeys();
  const config = settings?.config ?? {};

  const fieldKeys = [
    keys.url,
    BROWSER_URL_KEY,
    keys.storeId,
    keys.token,
    ...(hasAuthorizationClientRouting
      ? [keys.tlsIdentifier, ...CLIENT_ROUTES.map(routeKey)]
      : []),
  ];
  const saved: Form = Object.fromEntries(
    fieldKeys.map((k) => [k, config[k] ?? ""]),
  );

  const [form, setForm] = useState<Form>(saved);
  const [showToken, setShowToken] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);

  // Load the saved values once settings arrive.
  useEffect(() => {
    if (!isSettingsLoading) {
      setForm(saved);
    }
  }, [isSettingsLoading, settings]);

  const set = (key: string, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const changed = fieldKeys.filter((k) => form[k] !== saved[k]);
  const browserUrl = form[BROWSER_URL_KEY] || form[keys.url];
  const configured = !!form[keys.url] && !!form[keys.storeId];

  const client = () =>
    createOpenFgaClient({
      url: browserUrl,
      storeId: form[keys.storeId],
      token: form[keys.token],
    });

  const runTest = () => {
    setTesting(true);
    setTest(null);
    const c = client();
    Promise.all([fetchStoreName(c), fetchLatestModel(c)])
      .then(([name, model]) => {
        setTest({
          ok: true,
          message: model
            ? `Connected to store "${name}" with authorization model ${model.id}.`
            : `Connected to store "${name}". It has no authorization model yet; Incus writes it once it is configured with this store.`,
        });
      })
      .catch((e: unknown) => {
        setTest({ ok: false, message: describeOpenFgaError(e) });
      })
      .finally(() => {
        setTesting(false);
      });
  };

  const createStore = () => {
    setCreating(true);
    createOpenFgaClient({
      url: browserUrl,
      storeId: "",
      token: form[keys.token],
    })
      .createStore({ name: "incus" })
      .then((store) => {
        set(keys.storeId, store.id);
        toastNotify.success(
          `Created store "incus" (${store.id}). Save to point Incus at it.`,
        );
      })
      .catch((e: unknown) => {
        notify.failure(
          "Creating the store failed",
          new Error(describeOpenFgaError(e)),
        );
      })
      .finally(() => {
        setCreating(false);
      });
  };

  const save = () => {
    setSaving(true);
    const patch = Object.fromEntries(changed.map((k) => [k, form[k]]));
    updateSettings(patch)
      .then(async () => {
        toastNotify.success("Authorization settings saved.");
        await queryClient.invalidateQueries({ queryKey: [queryKeys.settings] });
        await queryClient.invalidateQueries({ queryKey: [queryKeys.openfga] });
      })
      .catch((e: unknown) => {
        notify.failure("Saving authorization settings failed", e);
      })
      .finally(() => {
        setSaving(false);
      });
  };

  // Routing, as it would be after saving.
  const effective = Object.fromEntries(
    CLIENT_ROUTES.map((r) => [r.key, effectiveRoute(r, form)]),
  );
  const hasOidc = settings?.auth_methods?.includes(AUTH_METHOD.OIDC);
  const myMethod = settings?.auth_user_method;
  const myRoute =
    myMethod === "tls" ? "tls" : myMethod === "oidc" ? "oidc" : "";
  const savedEffective = Object.fromEntries(
    CLIENT_ROUTES.map((r) => [r.key, effectiveRoute(r, saved)]),
  );
  const warnings: string[] = [];
  if (hasOidc && effective.oidc === "allow") {
    warnings.push(
      "OIDC users are routed to allow: everyone who can log in through your identity provider is a full admin. Route OIDC to openfga to restrict them.",
    );
  }
  if (
    myRoute &&
    effective[myRoute] !== savedEffective[myRoute] &&
    effective[myRoute] !== "allow"
  ) {
    warnings.push(
      `You are logged in with ${myMethod === "tls" ? "a TLS certificate" : "OIDC"}. After saving, your own requests go to ${effective[myRoute]}: without a matching grant you lose access to this UI. Root on the server&apos;s unix socket always keeps full access.`,
    );
  }
  if (Object.values(effective).includes("openfga") && !configured) {
    warnings.push(
      "Some clients are routed to openfga but no OpenFGA server is configured: Incus denies them until it is.",
    );
  }
  if (
    Object.values(effective).includes("scriptlet") &&
    !config["authorization.scriptlet"]
  ) {
    warnings.push(
      "Some clients are routed to scriptlet but authorization.scriptlet is empty: Incus denies them until it is set.",
    );
  }

  return (
    <CustomLayout
      header={
        <PageHeader>
          <PageHeader.Left>
            <PageHeader.Title>
              <HelpLink
                docPath="/authorization/"
                title="Learn more about authorization"
              >
                Authorization setup
              </HelpLink>
            </PageHeader.Title>
          </PageHeader.Left>
        </PageHeader>
      }
    >
      <NotificationRow />
      <Row>
        <Col size={8}>
          <Form
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <h2 className="p-heading--4">OpenFGA server</h2>
            <p className="u-text--muted">
              Keep OpenFGA on an internal network with a preshared key. This
              page talks to it from your browser, so it must also be reachable
              from admin machines over HTTPS and allow this page&apos;s origin
              in <code>--http-cors-allowed-origins</code>.
            </p>
            <Input
              type="url"
              label="API URL"
              help={<code>{keys.url}</code>}
              value={form[keys.url]}
              placeholder="https://openfga.internal:8080"
              onChange={(e) => {
                set(keys.url, e.target.value);
              }}
            />
            <Input
              type="url"
              label="Browser URL (optional)"
              help={
                <>
                  Used by this page instead of the API URL, when Incus reaches
                  OpenFGA by an address your browser cannot (stored in{" "}
                  <code>{BROWSER_URL_KEY}</code>).
                </>
              }
              value={form[BROWSER_URL_KEY]}
              onChange={(e) => {
                set(BROWSER_URL_KEY, e.target.value);
              }}
            />
            <Input
              type={showToken ? "text" : "password"}
              label="API token"
              help={
                <>
                  One of OpenFGA&apos;s preshared keys (
                  <code>--authn-method=preshared</code>). Stored in{" "}
                  <code>{keys.token}</code>, visible to server admins only.
                </>
              }
              value={form[keys.token]}
              autoComplete="off"
              onChange={(e) => {
                set(keys.token, e.target.value);
              }}
            />
            <Button
              type="button"
              appearance="base"
              className="u-no-margin--top"
              onClick={() => {
                setShowToken((v) => !v);
              }}
            >
              {showToken ? "Hide token" : "Show token"}
            </Button>
            <Input
              type="text"
              label="Store ID"
              help={<code>{keys.storeId}</code>}
              value={form[keys.storeId]}
              onChange={(e) => {
                set(keys.storeId, e.target.value);
              }}
            />
            {!form[keys.storeId] && browserUrl && (
              <ActionButton
                type="button"
                loading={creating}
                disabled={creating}
                onClick={createStore}
              >
                Create a store named incus
              </ActionButton>
            )}
            {hasAuthorizationClientRouting && (
              <Select
                label="TLS user identifier"
                help={
                  <>
                    What OpenFGA grants name TLS clients by (
                    <code>{keys.tlsIdentifier}</code>).
                  </>
                }
                value={form[keys.tlsIdentifier]}
                options={[
                  { label: "Certificate name (default)", value: "" },
                  { label: "Certificate name", value: "name" },
                  { label: "Certificate fingerprint", value: "fingerprint" },
                ]}
                onChange={(e) => {
                  set(keys.tlsIdentifier, e.target.value);
                }}
              />
            )}
            <ActionButton
              type="button"
              loading={testing}
              disabled={!configured || testing}
              onClick={runTest}
            >
              Test connection
            </ActionButton>
            {test && (
              <Notification
                severity={test.ok ? "positive" : "negative"}
                title={test.ok ? "Connected" : "Connection failed"}
                onDismiss={() => {
                  setTest(null);
                }}
              >
                {test.message}
              </Notification>
            )}

            <h2 className="p-heading--4 u-sv3">Who OpenFGA authorizes</h2>
            {hasAuthorizationClientRouting ? (
              <>
                <p className="u-text--muted">
                  Configuring OpenFGA does not restrict anyone by itself. Each
                  kind of client is routed to an authorization driver; route the
                  clients you want OpenFGA to decide for to <code>openfga</code>
                  . Root on the server&apos;s unix socket always has full
                  access.
                </p>
                <MainTable
                  headers={[
                    { content: "Clients" },
                    { content: "Driver" },
                    { content: "In effect" },
                  ]}
                  rows={CLIENT_ROUTES.map((route) => ({
                    key: route.key,
                    columns: [
                      {
                        content: (
                          <>
                            {route.label}
                            <br />
                            <code className="u-text--muted">
                              {routeKey(route)}
                            </code>
                          </>
                        ),
                      },
                      {
                        content: (
                          <Select
                            aria-label={`Driver for ${route.label}`}
                            className="u-no-margin--bottom"
                            value={form[routeKey(route)]}
                            options={[
                              { label: "Not set", value: "" },
                              ...route.drivers.map((d) => ({
                                label: d,
                                value: d,
                              })),
                            ]}
                            onChange={(e) => {
                              set(routeKey(route), e.target.value);
                            }}
                          />
                        ),
                      },
                      {
                        content: <strong>{effective[route.key]}</strong>,
                      },
                    ],
                  }))}
                />
              </>
            ) : (
              <p className="u-text--muted">
                This Incus version has no per-client routing: once OpenFGA is
                configured, it authorizes all remote clients.
              </p>
            )}
            {warnings.map((w) => (
              <Notification
                key={w}
                severity="caution"
                title="Check before saving"
              >
                {w}
              </Notification>
            ))}
            <ActionButton
              appearance="positive"
              type="submit"
              loading={saving}
              disabled={changed.length === 0 || saving}
            >
              Save
            </ActionButton>
            {changed.length > 0 && (
              <Button
                type="button"
                appearance="base"
                onClick={() => {
                  setForm(saved);
                }}
              >
                Discard changes
              </Button>
            )}
          </Form>
        </Col>
      </Row>
    </CustomLayout>
  );
};

export default AuthorizationSetup;
