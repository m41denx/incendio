import type { FC, ReactNode } from "react";
import { Col, CustomLayout, Row } from "@canonical/react-components";
import PageHeader from "@incendio/ui/components/PageHeader";

interface Props {
  title: ReactNode;
  /** A search box beside the title, as on Incendio's list pages. */
  search?: ReactNode;
  controls?: ReactNode;
  children: ReactNode;
}

/** A page in Incendio's layout: its PageHeader (title, search, actions) over the content. */
const PageLayout: FC<Props> = ({ title, search, controls, children }) => (
  <CustomLayout
    header={
      <PageHeader>
        <PageHeader.Left>
          <PageHeader.Title>{title}</PageHeader.Title>
          {search && <PageHeader.Search>{search}</PageHeader.Search>}
        </PageHeader.Left>
        {controls && <PageHeader.BaseActions>{controls}</PageHeader.BaseActions>}
      </PageHeader>
    }
  >
    <Row>
      <Col size={12}>{children}</Col>
    </Row>
  </CustomLayout>
);

export default PageLayout;
