import type { FC } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Col, CustomLayout, Row } from "@canonical/react-components";
import { fetchProjectAccess } from "api/access";
import { queryKeys } from "util/queryKeys";
import PageHeader from "components/PageHeader";
import HelpLink from "components/HelpLink";
import NotificationRow from "components/NotificationRow";
import ResourceAccessPanel from "components/ResourceAccessPanel";

const ProjectAccess: FC = () => {
  const { project: projectName } = useParams<{ project: string }>();

  if (!projectName) {
    return <>Missing project</>;
  }

  const {
    data: entries = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: [queryKeys.projects, projectName, queryKeys.access],
    queryFn: async () => fetchProjectAccess(projectName),
    // the api returns a 403 for non-admin users, surface the error right away
    retry: false,
  });

  return (
    <CustomLayout
      contentClassName="u-no-padding--bottom"
      header={
        <PageHeader>
          <PageHeader.Left>
            <PageHeader.Title>
              <HelpLink
                docPath="/explanation/security/"
                title="Learn more about access control"
              >
                Project access
              </HelpLink>
            </PageHeader.Title>
          </PageHeader.Left>
        </PageHeader>
      }
    >
      <NotificationRow />
      <Row>
        <Col size={12}>
          <ResourceAccessPanel
            entries={entries}
            isLoading={isLoading}
            error={error}
            tableId="project-access-table"
          />
        </Col>
      </Row>
    </CustomLayout>
  );
};

export default ProjectAccess;
