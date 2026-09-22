import type { FC } from "react";
import { useFormik } from "formik";
import {
  ActionButton,
  CheckboxInput,
  CustomLayout,
  Form,
  Input,
  Notification,
  Row,
  Select,
  Spinner,
  Textarea,
  useNotify,
  useToastNotification,
} from "@canonical/react-components";
import { useQueryClient } from "@tanstack/react-query";
import NotificationRow from "components/NotificationRow";
import PageHeader from "components/PageHeader";
import HelpLink from "components/HelpLink";
import { useSettings } from "context/useSettings";
import { updateSettings } from "api/server";
import { queryKeys } from "util/queryKeys";
import { useServerEntitlements } from "util/entitlements/server";

interface AcmeFormValues {
  agree_tos: boolean;
  email: string;
  domain: string;
  ca_url: string;
  challenge: string;
  http_port: string;
  provider: string;
  provider_environment: string;
  provider_resolvers: string;
  eab_kid: string;
  eab_hmac: string;
}

const AcmeSettings: FC = () => {
  const notify = useNotify();
  const toastNotify = useToastNotification();
  const queryClient = useQueryClient();
  const { data: settings, isLoading } = useSettings();
  const { canEditServerConfiguration } = useServerEntitlements();

  const config = settings?.config ?? {};

  const formik = useFormik<AcmeFormValues>({
    enableReinitialize: true,
    initialValues: {
      agree_tos: config["acme.agree_tos"] === "true",
      email: config["acme.email"] ?? "",
      domain: config["acme.domain"] ?? "",
      ca_url: config["acme.ca_url"] ?? "",
      challenge: config["acme.challenge"] ?? "",
      http_port: config["acme.http.port"] ?? "",
      provider: config["acme.provider"] ?? "",
      provider_environment: config["acme.provider.environment"] ?? "",
      provider_resolvers: config["acme.provider.resolvers"] ?? "",
      eab_kid: config["acme.eab.kid"] ?? "",
      eab_hmac: config["acme.eab.hmac"] ?? "",
    },
    onSubmit: (values) => {
      // Empty string unsets a server config key.
      const payload = {
        "acme.agree_tos": values.agree_tos ? "true" : "",
        "acme.email": values.email,
        "acme.domain": values.domain,
        "acme.ca_url": values.ca_url,
        "acme.challenge": values.challenge,
        "acme.http.port": values.http_port,
        "acme.provider": values.provider,
        "acme.provider.environment": values.provider_environment,
        "acme.provider.resolvers": values.provider_resolvers,
        "acme.eab.kid": values.eab_kid,
        "acme.eab.hmac": values.eab_hmac,
      };
      updateSettings(payload)
        .then(() => {
          toastNotify.success("ACME settings updated.");
          queryClient.invalidateQueries({ queryKey: [queryKeys.settings] });
        })
        .catch((e) => {
          notify.failure("Updating ACME settings failed", e);
        });
    },
  });

  const isDns = formik.values.challenge === "DNS-01";

  return (
    <CustomLayout
      header={
        <PageHeader>
          <PageHeader.Left>
            <PageHeader.Title>
              <HelpLink
                docPath="/howto/server_expose/"
                title="Learn more about ACME certificates"
              >
                ACME certificates
              </HelpLink>
            </PageHeader.Title>
          </PageHeader.Left>
        </PageHeader>
      }
      contentClassName="settings"
    >
      <NotificationRow />
      <Row>
        {!canEditServerConfiguration() && (
          <Notification
            severity="caution"
            title="Restricted permissions"
            titleElement="h2"
          >
            You do not have permission to view or edit server settings
          </Notification>
        )}
        {isLoading ? (
          <Spinner className="u-loader" text="Loading..." />
        ) : (
          canEditServerConfiguration() && (
            <Form onSubmit={formik.handleSubmit}>
              <p className="u-text--muted">
                Automatically obtain and renew the server&rsquo;s TLS
                certificate from an ACME provider (e.g. Let&rsquo;s Encrypt).
              </p>
              <CheckboxInput
                label="Agree to the ACME provider's terms of service"
                checked={formik.values.agree_tos}
                onChange={() => {
                  void formik.setFieldValue(
                    "agree_tos",
                    !formik.values.agree_tos,
                  );
                }}
              />
              <Input
                type="email"
                label="Account email"
                help="Email address used to register the ACME account."
                {...formik.getFieldProps("email")}
              />
              <Input
                type="text"
                label="Domain"
                help="Domain the certificate is issued for."
                {...formik.getFieldProps("domain")}
              />
              <Input
                type="text"
                label="CA URL"
                help="Directory URL of the ACME service. Defaults to Let's Encrypt."
                placeholder="https://acme-v02.api.letsencrypt.org/directory"
                {...formik.getFieldProps("ca_url")}
              />
              <Select
                label="Challenge type"
                options={[
                  { label: "HTTP-01", value: "HTTP-01" },
                  { label: "DNS-01", value: "DNS-01" },
                ]}
                {...formik.getFieldProps("challenge")}
              />
              {!isDns && (
                <Input
                  type="number"
                  label="HTTP-01 port"
                  help="Port the HTTP-01 challenge server listens on."
                  {...formik.getFieldProps("http_port")}
                />
              )}
              {isDns && (
                <>
                  <Input
                    type="text"
                    label="DNS provider"
                    help="lego DNS provider name (e.g. cloudflare, route53)."
                    {...formik.getFieldProps("provider")}
                  />
                  <Textarea
                    label="Provider environment"
                    help="One VAR=value per line, passed to the DNS provider."
                    {...formik.getFieldProps("provider_environment")}
                  />
                  <Input
                    type="text"
                    label="Provider resolvers"
                    help="Comma-separated custom DNS resolvers."
                    {...formik.getFieldProps("provider_resolvers")}
                  />
                </>
              )}
              <Input
                type="text"
                label="EAB key ID"
                help="External Account Binding key ID (if required by the CA)."
                {...formik.getFieldProps("eab_kid")}
              />
              <Input
                type="text"
                label="EAB HMAC"
                help="External Account Binding HMAC key."
                {...formik.getFieldProps("eab_hmac")}
              />
              <ActionButton
                appearance="positive"
                loading={formik.isSubmitting}
                disabled={!formik.dirty || formik.isSubmitting}
                onClick={() => void formik.submitForm()}
              >
                Save changes
              </ActionButton>
            </Form>
          )
        )}
      </Row>
    </CustomLayout>
  );
};

export default AcmeSettings;
