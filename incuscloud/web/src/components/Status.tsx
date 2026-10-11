import type { FC, ReactNode } from "react";
import { Notification, Spinner } from "@canonical/react-components";
import { ApiError } from "../api/client";

export const Loading: FC<{ text?: string }> = ({ text = "Loading…" }) => <Spinner text={text} />;

/** An API failure as a notification: its message, and what 403/404 mean here. */
export const ErrorMessage: FC<{ error: unknown; title?: ReactNode }> = ({ error, title }) => {
  const e = error instanceof ApiError ? error : null;
  const heading = title ?? (e?.status === 403 ? "Not allowed" : e?.status === 404 ? "Not found" : "Something went wrong");
  return (
    <Notification severity="negative" title={heading}>
      {error instanceof Error ? error.message : String(error)}
    </Notification>
  );
};

/** Renders children once the query has data; loading and errors otherwise. */
export function Loaded<T>({ query, children }: { query: { data: T | undefined; error: unknown; isPending: boolean }; children: (data: T) => ReactNode }) {
  if (query.error) return <ErrorMessage error={query.error} />;
  if (query.isPending || query.data === undefined) return <Loading />;
  return <>{children(query.data)}</>;
}

/** "3 min ago", or "never". */
export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}
