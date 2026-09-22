import type { FC } from "react";
import { useQuery } from "@tanstack/react-query";
import { Row } from "@canonical/react-components";
import { fetchInstanceAccess } from "api/access";
import { queryKeys } from "util/queryKeys";
import ResourceAccessPanel from "components/ResourceAccessPanel";
import type { LxdInstance } from "types/instance";

interface Props {
  instance: LxdInstance;
}

const InstanceAccess: FC<Props> = ({ instance }) => {
  const {
    data: entries = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: [
      queryKeys.instances,
      instance.name,
      instance.project,
      queryKeys.access,
    ],
    queryFn: async () => fetchInstanceAccess(instance.name, instance.project),
    // the api returns a 403 for non-admin users, surface the error right away
    retry: false,
  });

  return (
    <Row>
      <ResourceAccessPanel
        entries={entries}
        isLoading={isLoading}
        error={error}
        tableId="instance-access-table"
      />
    </Row>
  );
};

export default InstanceAccess;
