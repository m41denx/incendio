import type { FC, ReactNode } from "react";
import { Col, Panel, Row } from "@canonical/react-components";

interface Props {
  title: ReactNode;
  controls?: ReactNode;
  children: ReactNode;
}

/** A page: title, controls on the right, scrolling content (Incendio's layout). */
const PageLayout: FC<Props> = ({ title, controls, children }) => (
  <Panel title={title} controls={controls ? <div className="ic-page-controls">{controls}</div> : undefined} wrapContent>
    <Row>
      <Col size={12}>{children}</Col>
    </Row>
  </Panel>
);

export default PageLayout;
