import { useEffect, useState, type FC, type ReactNode } from "react";
import {
  Spinner,
  useNotify,
  useToastNotification,
} from "@canonical/react-components";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchOSSection, updateOSSection } from "api/os";
import NotificationRow from "components/NotificationRow";
import OSYamlEditor from "components/forms/OSYamlEditor";
import type { YamlFormValues } from "components/forms/YamlForm";
import { queryKeys } from "util/queryKeys";
import { objectToYaml, yamlToObject } from "util/yaml";

interface Props {
  endpoint: string;
  label: string;
  target: string;
  readOnly?: boolean;
  actions?: ReactNode;
}

const OSConfigSection: FC<Props> = ({
  endpoint,
  label,
  target,
  readOnly = false,
  actions,
}) => {
  const toastNotify = useToastNotification();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const [editorKey, setEditorKey] = useState(0);

  const queryKey = [queryKeys.osSection, endpoint, target];

  const { data, isLoading, error } = useQuery({
    queryKey,
    queryFn: async () => fetchOSSection(endpoint, target),
  });

  useEffect(() => {
    setEditorKey((k) => k + 1);
  }, [target]);

  const onSubmit = (
    values: YamlFormValues,
    handleSuccess: () => void,
    handleFailure: () => void,
  ) => {
    updateOSSection(endpoint, yamlToObject(values.yaml ?? ""), target)
      .then(() => {
        toastNotify.success(<>{label} updated</>);
        queryClient.invalidateQueries({ queryKey });
        handleSuccess();
      })
      .catch((e) => {
        toastNotify.failure(`${label} update failed`, e);
        handleFailure();
      });
  };

  if (error) {
    notify.failure(`Loading ${label.toLowerCase()} failed`, error);
  }

  return (
    <>
      <NotificationRow />
      {actions && (
        <div className="incusos-section-actions u-sv2">{actions}</div>
      )}
      {isLoading && (
        <Spinner
          className="u-loader"
          text={`Loading ${label.toLowerCase()}...`}
        />
      )}
      {!isLoading && !error && readOnly && (
        <pre className="yaml-code">
          <code>{objectToYaml(data ?? {})}</code>
        </pre>
      )}
      {!isLoading && !error && !readOnly && (
        <OSYamlEditor key={editorKey} yamlData={data} onSubmit={onSubmit} />
      )}
    </>
  );
};

export default OSConfigSection;
