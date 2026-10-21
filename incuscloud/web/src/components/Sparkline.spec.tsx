import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import Sparkline, { sparkPath } from "./Sparkline";

const at = (s: number) => new Date(Date.UTC(2026, 9, 11, 12, 0, s)).toISOString();

test("the path is split where values are missing, scaled to the box", () => {
  const d = sparkPath(
    [
      { at: at(0), value: 0 },
      { at: at(10), value: null },
      { at: at(20), value: 2 },
      { at: at(30), value: 4 },
    ],
    30,
    10,
    4,
  );
  expect(d).toBe("M0,10 L0,10 M20,5 L30,0");
});

test("a lone point between gaps is still drawn", () => {
  expect(sparkPath([{ at: at(0), value: 1 }], 100, 10, 2)).toBe("M0,5 L100,5");
});

test("the chart is labelled with its latest value and maximum", () => {
  render(<Sparkline label="CPU" format={(n) => `${n.toFixed(1)} cores`} points={[{ at: at(0), value: 0.5 }, { at: at(10), value: 2 }, { at: at(20), value: 1 }]} />);
  expect(screen.getByRole("img", { name: "CPU: 1.0 cores now, at most 2.0 cores" })).toBeInTheDocument();
  expect(screen.getByText("1.0 cores")).toBeInTheDocument();
});

test("no values yet", () => {
  render(<Sparkline label="CPU" format={String} points={[{ at: at(0), value: null }]} />);
  expect(screen.getByText("No data yet")).toBeInTheDocument();
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
});
