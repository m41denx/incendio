import { useEffect } from "react";
import { useSettings } from "context/useSettings";

export const setTitle = (): void => {
  const { data: settings } = useSettings();
  const suffix = "Incendio";

  useEffect(() => {
    const host = settings?.config?.["user.ui_title"] ?? location.hostname;
    document.title = `${host} | ${suffix}`;
  }, [settings?.config]);
};
