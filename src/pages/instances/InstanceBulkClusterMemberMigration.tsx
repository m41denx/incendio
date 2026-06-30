import type { FC } from "react";
import { ActionButton, Button } from "@canonical/react-components";
import type { LxdInstance } from "types/instance";
import ClusterMemberSelectTable from "../cluster/ClusterMemberSelectTable";
import { pluralize } from "util/helpers";

interface Props {
  instances: LxdInstance[];
  onSelect: (member: string) => void;
  targetMember: string;
  getMigratableInstances: (
    targetMember: string,
    targetPool: string,
    targetProject: string,
  ) => LxdInstance[];
  onCancel: () => void;
  migrate: () => void;
}

const InstanceBulkClusterMemberMigration: FC<Props> = ({
  instances,
  onSelect,
  targetMember,
  getMigratableInstances,
  onCancel,
  migrate,
}) => {
  const migratableCount = getMigratableInstances(targetMember, "", "").length;
  const skippedCount = instances.length - migratableCount;

  const summary = (
    <div className="migrate-instance-summary">
      <p>
        This will migrate <strong>{migratableCount}</strong>{" "}
        {pluralize("instance", migratableCount)} to cluster member{" "}
        <b>{targetMember}</b>.
        {skippedCount > 0 && (
          <>
            {" "}
            <strong>{skippedCount}</strong>{" "}
            {pluralize("instance", skippedCount)} already on this member will be
            skipped.
          </>
        )}
      </p>
    </div>
  );

  return (
    <>
      {targetMember && summary}
      {!targetMember && <ClusterMemberSelectTable onSelect={onSelect} />}
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
          onClick={migrate}
          disabled={!targetMember || migratableCount === 0}
        >
          Migrate
        </ActionButton>
      </footer>
    </>
  );
};

export default InstanceBulkClusterMemberMigration;
