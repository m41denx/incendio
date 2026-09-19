import { useEffect } from "react";
import { ROOT_PATH } from "util/rootPath";

export const setFavicon = (): void => {
  useEffect(() => {
    const favicon = document.querySelector("link[rel='shortcut icon']");
    if (!favicon) {
      return;
    }
    (favicon as HTMLLinkElement).href =
      `${ROOT_PATH}/ui/assets/img/incendio-32x32.png`;
  }, []);
};
