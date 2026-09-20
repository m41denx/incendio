import type { FC } from "react";
import { Link } from "react-router-dom";
import OSConfigSection from "pages/os/OSConfigSection";

interface Props {
  name: string;
  target: string;
}

const OSApplicationDetails: FC<Props> = ({ name, target }) => {
  return (
    <div>
      <div className="u-sv2">
        <Link to="/ui/os/applications">&larr; Applications</Link>
      </div>
      <OSConfigSection
        endpoint={`applications/${name}`}
        label="Application"
        target={target}
      />
    </div>
  );
};

export default OSApplicationDetails;
