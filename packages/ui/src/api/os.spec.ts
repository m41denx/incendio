import { prepareOSURL } from "./os";

describe("prepareOSURL", () => {
  it("prefixes the root path, so IncusOS calls go through a proxy prefix", () => {
    expect(prepareOSURL("/os/1.0", "", "/clusters/c1")).toBe(
      "/clusters/c1/os/1.0",
    );
  });

  it("adds the target member", () => {
    expect(prepareOSURL("/os/1.0/services", "m2", "")).toBe(
      "/os/1.0/services?target=m2",
    );
  });
});
