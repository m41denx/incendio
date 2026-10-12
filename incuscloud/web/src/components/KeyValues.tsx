import type { FC, ReactNode } from "react";

/** Facts as Incendio's detail pages show them: a table with muted headings. */
const KeyValues: FC<{ items: Array<[string, ReactNode]> }> = ({ items }) => (
  <table className="u-no-margin--bottom">
    <tbody>
      {items.map(([k, v]) => (
        <tr key={k}>
          <th scope="row" className="u-text--muted">
            {k}
          </th>
          <td>{v}</td>
        </tr>
      ))}
    </tbody>
  </table>
);

export default KeyValues;
