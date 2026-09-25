export type Nullable<T> = T | null;

export type DeepPartial<T> = T extends (infer U)[]
  ? DeepPartial<U>[]
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

/**
 * Request body: every field optional (the daemon fills in defaults) except
 * the keys in `K`.
 *
 * Incus request structs mark most fields as non-`omitempty` even though they
 * are optional on the wire, so the generated types are too strict for input.
 */
export type Input<T, K extends keyof T = never> = DeepPartial<T> & {
  [P in K]-?: NonNullable<DeepPartial<T[P]>>;
};
