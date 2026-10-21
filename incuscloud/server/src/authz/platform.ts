export interface Tuple {
  user: string;
  relation: string;
  object: string;
}

/**
 * Platform-level authorization: who may do what to the platform, tenants and
 * clusters, as relations. Answered by the ACL (acl-authz.ts) while call sites
 * move to privileges on paths.
 */
export interface Authz {
  check(user: string, relation: string, object: string): Promise<boolean>;
  /** Tuples are no longer stored; a write tells the ACL that roles changed. */
  write(writes: Tuple[], deletes?: Tuple[]): Promise<void>;
  listObjects(user: string, relation: string, type: string): Promise<string[]>;
}

export const PLATFORM = "platform:main";
