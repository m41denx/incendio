import type { FC } from "react";
import { Route, Routes, useParams } from "react-router-dom";
import { Spinner } from "@canonical/react-components";
import { ROOT_PATH } from "util/rootPath";
import { useInstance } from "context/useInstances";
import InstanceConsole from "pages/instances/InstanceConsole";
import InstanceStateActions from "pages/instances/actions/InstanceStateActions";
import ProtectedRoute from "components/ProtectedRoute";
import NotFound from "components/NotFound";
import NoMatch from "components/NoMatch";

const MinimalConsoleView: FC = () => {
  const { name, project } = useParams<{ name: string; project: string }>();

  if (!name || !project) {
    return <NoMatch />;
  }

  const { data: instance, error, isLoading } = useInstance(name, project);

  if (isLoading) {
    return (
      <Spinner
        className="u-loader"
        text="Loading instance..."
        isMainComponent
      />
    );
  }

  if (!instance) {
    return (
      <NotFound
        entityType="instance"
        entityName={name}
        errorMessage={error?.message}
      />
    );
  }

  return (
    <main className="minimal-console" id="main-content">
      <div className="minimal-console-controls">
        <h1
          className="minimal-console-title p-heading--4 u-no-margin--bottom"
          title={instance.name}
        >
          {instance.name}
        </h1>
        <InstanceStateActions instance={instance} hideMigrate />
      </div>
      <InstanceConsole instance={instance} />
    </main>
  );
};

const MinimalConsole: FC = () => {
  return (
    <Routes>
      <Route
        path={`${ROOT_PATH}/ui/project/:project/instance/:name/console`}
        element={<ProtectedRoute outlet={<MinimalConsoleView />} />}
      />
      <Route path="*" element={<NoMatch />} />
    </Routes>
  );
};

export default MinimalConsole;
