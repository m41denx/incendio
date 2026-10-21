import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import Failed from "./Failed";

test("failure text carries Incendio's failed status icon and the detail as a tooltip", () => {
  render(<Failed title="disk full">Failed</Failed>);
  const text = screen.getByText("Failed");
  expect(text).toHaveAttribute("title", "disk full");
  expect(text.querySelector(".p-icon--status-failed-small.status-icon")).not.toBeNull();
});
