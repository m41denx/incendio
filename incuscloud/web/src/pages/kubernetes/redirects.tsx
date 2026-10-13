import type { FC } from "react";
import { Navigate, useParams } from "react-router-dom";
import { clusterOf, nameOf } from "../inventory/tree";
import { Loading } from "../../components/Status";
import { useK8sClusters } from "./useK8sClusters";

// Old inventory URLs of Kubernetes clusters: the platform's pages now.

/** `/inventory/<c>/kubernetes`, `/ui/project/<p@c>/kubernetes`: the list, for that Incus cluster. */
export const K8sListRedirect: FC<{ by: "cluster" | "project" }> = ({ by }) => {
  const p = useParams();
  const cluster = by === "cluster" ? (p.cluster ?? "") : clusterOf(p.project ?? "");
  return <Navigate to={cluster ? `/kubernetes?cluster=${encodeURIComponent(cluster)}` : "/kubernetes"} replace />;
};

/** `/ui/project/<p@c>/kubernetes/<name>[/<tab>]`: that cluster's page, found by project and name. */
export const K8sNameRedirect: FC = () => {
  const { project = "", name = "" } = useParams();
  const list = useK8sClusters({ cluster: clusterOf(project) });
  if (list.isPending) return <Loading />;
  const found = list.data?.find((k) => k.project === nameOf(project) && k.name === name);
  return <Navigate to={found ? `/kubernetes/${found.id}` : "/kubernetes"} replace />;
};
