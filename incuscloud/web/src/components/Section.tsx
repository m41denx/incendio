import type { FC, ReactNode } from "react";
import { Col } from "@canonical/react-components";

/** A section of a detail page, as Incendio's overviews lay them out: the heading on the left, the content beside it. */
const Section: FC<{ title: ReactNode; id: string; children: ReactNode }> = ({ title, id, children }) => (
  <section className="row" aria-labelledby={id}>
    <Col size={3}>
      <h2 id={id} className="p-heading--5">
        {title}
      </h2>
    </Col>
    <Col size={9}>{children}</Col>
  </section>
);

export default Section;
