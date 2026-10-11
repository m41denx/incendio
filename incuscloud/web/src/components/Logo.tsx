import type { FC } from "react";
import { Link } from "react-router-dom";

/** Vanilla's panel logo markup, with the name as text (react-components wants an image for it). */
const Logo: FC = () => (
  <Link to="/" className="p-panel__logo" aria-label="IncusCloud home">
    <img className="p-panel__logo-icon" src="/assets/favicon.svg" alt="" width={24} height={24} />
    <span className="p-panel__logo-name is-fading-when-collapsed ic-brand">IncusCloud</span>
  </Link>
);

export default Logo;
