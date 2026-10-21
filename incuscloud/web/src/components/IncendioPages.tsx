import { type FC, useEffect } from "react";
import { useLocation } from "react-router-dom";
import IncendioApp from "@incendio/ui/App";
import NotFound from "../pages/NotFound";

/**
 * Incendio's own pages (`/ui/…`), over the federation facade: every cluster
 * as one. Its sign-in page is IncusCloud's.
 */
const IncendioPages: FC = () => {
  const { pathname } = useLocation();
  const signIn = pathname === "/ui/login" || pathname.startsWith("/ui/login/");
  useEffect(() => {
    if (signIn) window.location.assign(`/auth/start?return_to=${encodeURIComponent("/ui")}`);
  }, [signIn]);
  if (signIn) return null;
  if (pathname !== "/ui" && !pathname.startsWith("/ui/")) return <NotFound />;
  return <IncendioApp />;
};

export default IncendioPages;
