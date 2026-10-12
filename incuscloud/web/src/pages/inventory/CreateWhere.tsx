import { type FC, useEffect } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { Notification, Select, Spinner } from "@canonical/react-components";
import { useProjects } from "@incendio/ui/context/useProjects";
import { clusterOf, nameOf } from "./tree";
import { clustersOf, placeFor, projectsOn } from "./where";

const createUrl = (project: string, search = "") => `/ui/project/${encodeURIComponent(project)}/instances/create${search}`;

/**
 * Where the instance goes, above Incendio's create form: the cluster, then
 * the project on it. The form below (profiles, networks, storage, images,
 * and Incendio's own target member) is that cluster's. A project that
 * names no cluster, or one the cluster lacks, is replaced at once.
 */
const CreateWhere: FC = () => {
  const { project = "" } = useParams<{ project: string }>();
  const { search } = useLocation();
  const navigate = useNavigate();
  const { data, isLoading } = useProjects();
  const names = (data ?? []).map((p) => p.name);
  const cluster = clusterOf(project);
  const base = cluster ? nameOf(project) : project;
  const known = names.includes(project) && !!cluster;
  const fallback = isLoading ? null : placeFor(names, { base, cluster: cluster || undefined });

  useEffect(() => {
    // Keep the URL's target only when the cluster stays the same.
    if (!known && fallback) navigate(createUrl(fallback, cluster && clusterOf(fallback) === cluster ? search : ""), { replace: true });
  }, [known, fallback]);

  if (isLoading || (!known && fallback)) return <Spinner text="Loading clusters…" />;
  if (!known) {
    return (
      <Notification severity="caution" title="No cluster to create on">
        You have no project on any cluster yet.
      </Notification>
    );
  }

  return (
    <>
        <Select
          id="ic-create-cluster"
          label="Cluster"
          value={cluster}
          options={clustersOf(names).map((c) => ({ label: c, value: c }))}
          onChange={(e) => {
            const to = placeFor(names, { base, cluster: e.target.value });
            if (to) navigate(createUrl(to));
          }}
          help="The instance is created on this cluster: the profiles, networks, storage, images and members below are its own."
        />
        <Select
          id="ic-create-project"
          label="Project"
          value={base}
          options={projectsOn(names, cluster).map((p) => ({ label: p, value: p }))}
          onChange={(e) => navigate(createUrl(`${e.target.value}@${cluster}`, search))}
        />
    </>
  );
};

export default CreateWhere;
