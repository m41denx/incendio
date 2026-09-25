import { metallbAddressesError } from "./metallb";

describe("metallbAddressesError", () => {
  it("accepts ranges, CIDRs and addresses, comma or space separated", () => {
    expect(
      metallbAddressesError("10.0.0.200-10.0.0.220, 10.0.1.0/28 10.0.2.5"),
    ).toBeNull();
  });

  it("rejects empty input, IPv6, bad octets and reversed ranges", () => {
    expect(metallbAddressesError(" ")).toMatch(/at least one/);
    expect(metallbAddressesError("fd00::/64")).toMatch(/not an IPv4/);
    expect(metallbAddressesError("10.0.0.256")).toMatch(/not an IPv4/);
    expect(metallbAddressesError("10.0.0.20-10.0.0.10")).toMatch(
      /ends before it starts/,
    );
  });
});
