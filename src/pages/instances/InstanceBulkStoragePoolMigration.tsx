import type { FC } from "react";
import { useEffect, useState } from "react";
import { ActionButton, Button, Select } from "@canonical/react-components";
import { useQuery } from "@tanstack/react-query";
import StoragePoolSelectTable from "../storage/StoragePoolSelectTable";
import { fetchClusterMembers } from "api/cluster-members";
import type { LxdInstance } from "types/instance";
import { pluralize } from "util/helpers";
import { queryKeys } from "util/queryKeys";

interface Props {
  instances: LxdInstance[];
  onSelect: (pool: string) => void;
  targetPool: string;
  getMigratableInstances: (
    targetMember: string,
    targetPool: string,
    targetProject: string,
  ) => LxdInstance[];
  onCancel: () => void;
  migrate: (targetMember: string) => void;
}

const InstanceBulkStoragePoolMigration: FC<Props> = ({
  instances,
  onSelect,
  targetPool,
  getMigratableInstances,
  onCancel,
  migrate,
}) => {
  // Live VMs are also moved to a target cluster member during a root storage
  // pool migration, so we offer a member picker when any running VM is selected.
  const hasLiveInstances = instances.some(
    (instance) =>
      instance.type === "virtual-machine" && instance.status === "Running",
  );
  const [targetMember, setTargetMember] = useState("");

  const { data: members = [] } = useQuery({
    queryKey: [queryKeys.cluster, queryKeys.members],
    queryFn: fetchClusterMembers,
    enabled: hasLiveInstances,
  });

  const memberOptions = members.map((item) => {
    return { label: item.server_name, value: item.server_name };
  });

  useEffect(() => {
    if (memberOptions.length > 0 && !targetMember) {
      setTargetMember(memberOptions[0].value);
    }
  }, [memberOptions]);

  const migratableCount = getMigratableInstances(
    targetMember,
    targetPool,
    "",
  ).length;
  const skippedCount = instances.length - migratableCount;

  const summary = (
    <div className="migrate-instance-summary">
      <p>
        This will migrate the root storage of <strong>{migratableCount}</strong>{" "}
        {pluralize("instance", migratableCount)} to pool <b>{targetPool}</b>.
        {skippedCount > 0 && (
          <>
            {" "}
            <strong>{skippedCount}</strong>{" "}
            {pluralize("instance", skippedCount)} already on the chosen target
            will be skipped.
          </>
        )}
        {hasLiveInstances && memberOptions.length > 0 && (
          <>
            {" "}
            Select target server for live migrations:
            <Select
              options={memberOptions}
              value={targetMember}
              onChange={(e) => {
                setTargetMember(e.target.value);
              }}
            />
          </>
        )}
      </p>
    </div>
  );

  return (
    <>
      {targetPool && summary}
      {!targetPool && <StoragePoolSelectTable onSelect={onSelect} />}
      <footer id="migrate-instance-actions" className="p-modal__footer">
        <Button
          className="u-no-margin--bottom"
          type="button"
          aria-label="cancel migrate"
          appearance="base"
          onClick={onCancel}
        >
          Cancel
        </Button>
        <ActionButton
          appearance="positive"
          className="u-no-margin--bottom"
          onClick={() => {
            migrate(targetMember);
          }}
          disabled={!targetPool || migratableCount === 0}
        >
          Migrate
        </ActionButton>
      </footer>
    </>
  );
};

export default InstanceBulkStoragePoolMigration;
