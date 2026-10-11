import type { FC, ReactNode } from "react";

/** A two-column list of facts. */
const KeyValues: FC<{ items: Array<[string, ReactNode]> }> = ({ items }) => (
  <dl className="ic-kv">
    {items.map(([k, v]) => (
      <div key={k} style={{ display: "contents" }}>
        <dt>{k}</dt>
        <dd>{v}</dd>
      </div>
    ))}
  </dl>
);

export default KeyValues;
