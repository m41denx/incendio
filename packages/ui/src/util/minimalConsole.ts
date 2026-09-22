import { useLocation } from "react-router-dom";

// Query parameter that switches the console page into a minimal, chrome-free
// view exposing only the console and power controls. Useful when Incus is
// embedded behind a self service portal or for restricted users.
export const MINIMAL_CONSOLE_PARAM = "minimal";

export const useIsMinimalConsole = (): boolean => {
  const { search } = useLocation();
  return new URLSearchParams(search).has(MINIMAL_CONSOLE_PARAM);
};
