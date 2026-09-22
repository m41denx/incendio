import type { FC } from "react";
import { ActionButton, Button } from "@canonical/react-components";
import type { LxdInstance } from "types/instance";
import ProjectSelectTable from "pages/projects/ProjectSelectTable";
import { pluralize } from "util/helpers";

interface Props {
  instances: LxdInstance[];
  onSelect: (project: string) => void;
  targetProject: string;
  getMigratableInstances: (
    targetMember: string,
    targetPool: string,
    targetProject: string,
  ) => LxdInstance[];
  onCancel: () => void;
  migrate: () => void;
}

const InstanceBulkProjectMigration: FC<Props> = ({
  instances,
  onSelect,
  targetProject,
  getMigratableInstances,
  onCancel,
  migrate,
}) => {
  const migratableCount = getMigratableInstances("", "", targetProject).length;
  const skippedCount = instances.length - migratableCount;

  const summary = (
    <div className="migrate-instance-summary">
      <p>
        This will migrate <strong>{migratableCount}</strong>{" "}
        {pluralize("instance", migratableCount)} to the project{" "}
        <b>{targetProject}</b>.
        {skippedCount > 0 && (
          <>
            {" "}
            <strong>{skippedCount}</strong>{" "}
            {pluralize("instance", skippedCount)} already in this project will
            be skipped.
          </>
        )}
      </p>
    </div>
  );

  return (
    <>
      {targetProject && summary}
      {!targetProject && <ProjectSelectTable onSelect={onSelect} />}
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
          disabled={!targetProject || migratableCount === 0}
        >
          Migrate
        </ActionButton>
      </footer>
    </>
  );
};

export default InstanceBulkProjectMigration;
