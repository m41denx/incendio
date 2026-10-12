import type { FC } from "react";
import { Link } from "react-router-dom";

/** Incendio's panel logo: the mark and the name as a heading. */
const Logo: FC = () => (
  <Link className="p-panel__logo" to="/" aria-label="IncusCloud home">
    <img src="/assets/img/incuscloud-logo.svg" alt="" className="p-panel__logo-image" />
    <div className="logo-text p-heading--4">IncusCloud</div>
  </Link>
);

export default Logo;
