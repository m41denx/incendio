export const IMAGE_SERVERS_KEY = "user.ui.image_servers";

export type ImageServerProtocol = "simplestreams";

export interface ImageServer {
  name: string;
  url: string;
  protocol: ImageServerProtocol;
}

// Parse the user.ui.image_servers config value into a list of servers.
// Falls back to an empty list when unset or malformed.
export const parseImageServers = (value?: string): ImageServer[] => {
  if (!value) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((item): item is Record<string, unknown> => {
        return (
          typeof item === "object" &&
          item !== null &&
          typeof (item as Record<string, unknown>).url === "string"
        );
      })
      .map((item) => ({
        name: typeof item.name === "string" ? item.name : "",
        url: item.url as string,
        protocol: "simplestreams",
      }));
  } catch {
    return [];
  }
};

export const serializeImageServers = (servers: ImageServer[]): string => {
  return JSON.stringify(servers);
};
