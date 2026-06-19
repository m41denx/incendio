import { FC } from "react";
import { Spinner } from "@canonical/react-components";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "util/queryKeys";
import { fetchInstancePreview } from "api/instances";
import { LxdInstance } from "types/instance";

interface Props {
    instance: LxdInstance;
    refetch: boolean;
    onFailure: (title: string, e: unknown) => void;
}

const InstancePreview: FC<Props> = ({ instance, refetch, onFailure }) => {

    const queryOptions = refetch
      ? {
          queryKey: [queryKeys.instancePreview, instance.project, instance.name],
          queryFn: () => fetchInstancePreview(instance),
          refetchInterval: 5 * 1000, // 5s
        }
      : {
          queryKey: [queryKeys.instancePreview, instance.project, instance.name],
          queryFn: () => fetchInstancePreview(instance),
          staleTime: 10 * 1000, // 10s
        };

    const {
    data: imgData,
    error,
    isLoading,
  } = useQuery(queryOptions);

  return (
    <>
      {isLoading ? (
        <Spinner className="u-loader" text="Loading instance preview..." isMainComponent />
      ) : (
        <img src={imgData} style={{ margin: "0 auto", display: "block"}} />
      )}
    </>
  );
};

export default InstancePreview;
