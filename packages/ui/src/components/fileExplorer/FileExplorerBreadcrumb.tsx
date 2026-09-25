import type { FC } from "react";
import { Link } from "react-router-dom";
import { baseName, pathAncestors } from "util/fileExplorer";

interface Props {
  currentPath: string;
  directoryLink: (path: string) => string;
}

const FileExplorerBreadcrumb: FC<Props> = ({ currentPath, directoryLink }) => {
  const crumbs = pathAncestors(currentPath);
  return (
    <nav
      className="p-breadcrumbs p-breadcrumbs--large"
      aria-label="File Explorer Path"
    >
      <ol className="p-breadcrumbs__items breadcrumb-wrapper">
        <li className="p-heading--4 breadcrumb-header">Directory:&nbsp;</li>
        {crumbs.map((path, index) => {
          const label = path === "/" ? "root" : baseName(path);
          return (
            <li key={path} className="p-heading--4 continuous-breadcrumb">
              {index === crumbs.length - 1 ? (
                <span>{label}</span>
              ) : (
                <Link to={directoryLink(path)}>{label}</Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
};

export default FileExplorerBreadcrumb;
