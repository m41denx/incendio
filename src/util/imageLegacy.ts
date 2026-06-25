import type {
  RemoteImage,
  RemoteImageList,
  RemoteImagesResult,
} from "types/image";
import { capitalizeFirstLetter, handleResponse } from "util/helpers";
import type { ImageServer } from "util/imageServers";

export const linuxContainersServer = "https://images.linuxcontainers.org";

const streamsIndex = (server: string): string => {
  return `${server.replace(/\/$/, "")}/streams/v1/images.json`;
};

// fetching directly from hard coded indexes and servers,
// layering any user-defined simplestreams servers on top of the defaults
export const loadRemoteImagesLegacy = async (
  userServers: ImageServer[] = [],
): Promise<RemoteImagesResult> => {
  // keep the Incendio default server(s) and add user-configured servers on top
  const servers: { url: string; name: string | undefined }[] = [
    { url: linuxContainersServer, name: undefined },
    ...userServers.map((server) => ({ url: server.url, name: server.name })),
  ];

  const results = await Promise.all(
    servers.map(async ({ url, name }) =>
      loadImageJson(streamsIndex(url), url, name),
    ),
  );

  const images = results.flatMap((result) => result.images);
  const errors = results.map((result) => result.error).filter((e) => e !== "");

  return { images, error: errors.join(". ") };
};

const loadImageJson = async (
  file: string,
  server: string,
  serverName?: string,
): Promise<RemoteImagesResult> => {
  return new Promise((resolve) => {
    fetch(file)
      .then(handleResponse)
      .then((data: RemoteImageList) => {
        const images: RemoteImage[] = Object.entries(data.products).map(
          (product) => {
            const { os, ...image } = product[1];
            const formattedOs = capitalizeFirstLetter(os);
            return { ...image, os: formattedOs, server, serverName };
          },
        );
        resolve({ images, error: "" });
      })
      .catch((e: Error) => {
        resolve({ images: [], error: e.message });
      });
  });
};
