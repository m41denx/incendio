import type { FC, JSX } from "react";
import { Link } from "react-router-dom";
import { Col, CustomLayout, Row, Spinner } from "@canonical/react-components";
import { useSupportedFeatures } from "context/useSupportedFeatures";
import { ROOT_PATH } from "util/rootPath";

interface Props {
  outlet: JSX.Element;
}

// The permissions pages drive LXD's fine-grained authorization API
// (access_management). Incus has none — it delegates authorization to
// OpenFGA — so the nav hides them; this also stops a typed or bookmarked URL
// from opening a page whose every request fails.
const AccessManagementRoute: FC<Props> = ({ outlet }) => {
  const { hasAccessManagement, isSettingsLoading } = useSupportedFeatures();

  if (isSettingsLoading) {
    return <Spinner className="u-loader" text="Loading..." isMainComponent />;
  }
  if (hasAccessManagement) {
    return outlet;
  }
  return (
    <CustomLayout mainClassName="no-match">
      <Row>
        <Col size={6} className="col-start-large-4">
          <h1 className="p-heading--4">
            Permissions are managed outside Incus
          </h1>
          <p>
            This server has no fine-grained permissions API: Incus hands
            authorization to OpenFGA, so identities and groups are managed
            there.
            <br />
            Client certificates this server trusts are listed under{" "}
            <Link to={`${ROOT_PATH}/ui/settings/certificates`}>
              Trusted certificates
            </Link>
            .
          </p>
        </Col>
      </Row>
    </CustomLayout>
  );
};

export default AccessManagementRoute;
