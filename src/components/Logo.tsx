import type { FC } from "react";
import { useCurrentProject } from "context/useCurrentProject";
import { NavLink } from "react-router-dom";
import classNames from "classnames";
import { ROOT_PATH } from "util/rootPath";

interface Props {
  light?: boolean;
}

const Logo: FC<Props> = ({ light }) => {
  const { project, isLoading } = useCurrentProject();

  const src = `${ROOT_PATH}/ui/assets/img/incendio-logo.svg`;
  const heading = "Incendio";

  const getLogoLink = () => {
    if (isLoading || !project) {
      return `${ROOT_PATH}/ui/`;
    }
    return `${ROOT_PATH}/ui/project/${encodeURIComponent(project.name)}`;
  };

  return (
    <NavLink className="p-panel__logo" to={getLogoLink()}>
      <img src={src} alt="Incendio logo" className="p-panel__logo-image" />
      <div
        className={classNames("logo-text p-heading--4", { "is-light": light })}
      >
        {heading}
      </div>
    </NavLink>
  );
};

export default Logo;
