import type { FC } from "react";
import { Link } from "react-router-dom";
import PageLayout from "../components/PageLayout";

const NotFound: FC = () => (
  <PageLayout title="Page not found">
    <p>
      There is nothing here. <Link to="/">Go to the dashboard</Link>.
    </p>
  </PageLayout>
);

export default NotFound;
