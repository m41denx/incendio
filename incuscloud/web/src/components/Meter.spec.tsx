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
  expect(meter.querySelector(".ic-meter__fill")).toHaveStyle({ width: "25%" });
  expect(screen.getByText("1.0 GiB / 4.0 GiB (25%)")).toBeInTheDocument();
});

test("the fill turns caution at 80% and negative at 95%", () => {
  const { rerender, container } = render(<Meter used={79} total={100} />);
  expect(container.querySelector(".ic-meter__fill")).not.toHaveClass("ic-meter__fill--caution", "ic-meter__fill--negative");
  rerender(<Meter used={80} total={100} />);
  expect(container.querySelector(".ic-meter__fill")).toHaveClass("ic-meter__fill--caution");
  expect(container.querySelector(".ic-meter__fill")).not.toHaveClass("ic-meter__fill--negative");
  rerender(<Meter used={95} total={100} />);
  expect(container.querySelector(".ic-meter__fill")).toHaveClass("ic-meter__fill--negative");
  expect(container.querySelector(".ic-meter__fill")).not.toHaveClass("ic-meter__fill--caution");
});

test("the fill is clamped to the bar when used exceeds total", () => {
  const { container } = render(<Meter used={150} total={100} />);
  expect(container.querySelector(".ic-meter__fill")).toHaveStyle({ width: "100%" });
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
