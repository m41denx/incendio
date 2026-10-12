import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import KeyValues from "./KeyValues";

test("facts are Incendio's details table: muted headings, values beside them", () => {
  render(<KeyValues items={[["Name", "web"], ["Status", <b key="s">Running</b>]]} />);
  const heading = screen.getByRole("rowheader", { name: "Name" });
  expect(heading).toHaveClass("u-text--muted");
  expect(heading.closest("tr")).toHaveTextContent("Nameweb");
  expect(screen.getByRole("rowheader", { name: "Status" }).nextElementSibling).toHaveTextContent("Running");
});
