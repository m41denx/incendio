export interface LxdWarning {
  status: LxdWarningStatus;
  uuid: string;
  project: string;
  /** The cluster member the warning is from (empty on a standalone server). */
  location?: string;
  type: string;
  count: number;
  first_seen_at: string;
  last_seen_at: string;
  last_message: string;
  severity: LxdWarningSeverity;
  access_entitlements?: string[];
}

export type LxdWarningStatus = "new" | "acknowledged" | "resolved";
export type LxdWarningSeverity = "low" | "moderate" | "high";
