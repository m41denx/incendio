/**
 * The inventory (cluster → node → instance) over the federation facade,
 * where what belongs to one cluster is named `name@cluster`.
 */
export const clusterOf = (qualified: string) => {
  const at = qualified.lastIndexOf("@");
  return at < 0 ? "" : qualified.slice(at + 1);
};
export const nameOf = (qualified: string) => {
  const at = qualified.lastIndexOf("@");
  return at < 0 ? qualified : qualified.slice(0, at);
};
