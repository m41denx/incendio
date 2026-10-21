import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import Meter from "./Meter";

const GiB = 1024 ** 3;

test("the bar is a meter with its values and label", () => {
  render(<Meter used={1 * GiB} total={4 * GiB} label="prod memory" />);
  const meter = screen.getByRole("meter", { name: "prod memory" });
  expect(meter).toHaveAttribute("aria-valuemin", "0");
  expect(meter).toHaveAttribute("aria-valuemax", String(4 * GiB));
  expect(meter).toHaveAttribute("aria-valuenow", String(GiB));
  expect(meter.querySelector<HTMLElement>(".p-meter > div")!.style.width).toBe("max(25%, 5px)");
  expect(screen.getByText("1.0 GiB / 4.0 GiB (25%)")).toBeInTheDocument();
});

test("it is Incendio's meter: one blue fill, whatever the level", () => {
  const { container } = render(<Meter used={99} total={100} />);
  expect(container.querySelectorAll(".p-meter > div")).toHaveLength(1);
  expect(container.querySelector(".p-meter + .p-text--small.u-text--muted")).toHaveTextContent("99 B / 100 B (99%)");
});

test("the fill is clamped to the bar when used exceeds total", () => {
  const { container } = render(<Meter used={150} total={100} />);
  expect(container.querySelector<HTMLElement>(".p-meter > div")!.style.width).toBe("max(100%, 5px)");
});

test("without a total there is no bar, only the unknown marker", () => {
  const { rerender } = render(<Meter used={1} total={0} />);
  expect(screen.queryByRole("meter")).not.toBeInTheDocument();
  expect(screen.getByText("—")).toBeInTheDocument();
  rerender(<Meter used={null} total={100} />);
  expect(screen.queryByRole("meter")).not.toBeInTheDocument();
  expect(screen.getByText("—")).toBeInTheDocument();
});

test("the values can be formatted by the caller", () => {
  render(<Meter used={2} total={8} format={(n) => `${n} cores`} />);
  expect(screen.getByText("2 cores / 8 cores (25%)")).toBeInTheDocument();
});
