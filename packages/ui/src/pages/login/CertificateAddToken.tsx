import type { FC } from "react";
import {
  Accordion,
  CodeSnippet,
  Col,
  Row,
  useNotify,
  Spinner,
  CustomLayout,
} from "@canonical/react-components";
import { Navigate } from "react-router-dom";
import { useAuth } from "context/auth";
import CertificateAddForm from "pages/login/CertificateAddForm";
import NotificationRow from "components/NotificationRow";
import CodeSnippetWithCopyButton from "components/CodeSnippetWithCopyButton";
import { ROOT_PATH } from "util/rootPath";
import { isPermanent } from "util/authentication";
import CertificateAddNotifications from "components/CertificateAddNotifications";

const CertificateAddToken: FC = () => {
  const { isAuthenticated, isAuthLoading, authMethod } = useAuth();
  const notify = useNotify();
  const identityTrustTokenCommand = "incus config trust add incendio-ui";

  if (isAuthLoading) {
    return <Spinner className="u-loader" text="Loading..." isMainComponent />;
  }

  if (isAuthenticated && isPermanent(authMethod)) {
    return <Navigate to={`${ROOT_PATH}/ui`} replace={true} />;
  }

  return (
    <CustomLayout mainClassName="certificate-generate">
      <Row>
        <Col size={2} />
        <Col size={8}>
          {notify.notification ? (
            <NotificationRow />
          ) : (
            <Row>
              <CertificateAddNotifications />
            </Row>
          )}
          <div className="p-stepped-list__content">
            <p>
              Paste the following command into the console of the machine where
              Incus is running:
            </p>

            <CodeSnippetWithCopyButton code={identityTrustTokenCommand} />
            <Accordion
              sections={[
                {
                  title: <>What does this command do?</>,
                  content: (
                    <>
                      <p>
                        Incus authorizes TLS clients through its trust store.
                        The command adds a new trusted client named{" "}
                        <code>incendio-ui</code> and returns a trust token.
                      </p>
                      <CodeSnippet
                        blocks={[
                          {
                            code: `incus config trust add incendio-ui`,
                            wrapLines: true,
                          },
                        ]}
                      />
                      <p>
                        Paste the returned trust token below. When you submit
                        it, the certificate generated for this browser is added
                        to the Incus trust store, granting it access.
                      </p>
                    </>
                  ),
                },
              ]}
            />
            <Accordion
              sections={[
                {
                  title: <>I already have a trust token</>,
                  content: (
                    <>
                      <p>
                        If you already have a trust token (for example from{" "}
                        <code>incus config trust add</code>), use it below. No
                        extra steps needed.
                      </p>
                    </>
                  ),
                },
              ]}
            />
          </div>
          <div className="p-stepped-list__content">
            <br />
            <CertificateAddForm />
          </div>
        </Col>
      </Row>
    </CustomLayout>
  );
};

export default CertificateAddToken;
