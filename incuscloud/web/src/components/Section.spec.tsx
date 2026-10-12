import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import Section from "./Section";

test("a detail-page section is Incendio's overview row: small heading on the left, content beside it", () => {
  const { container } = render(
    <Section title="General" id="general">
      <p>facts</p>
    </Section>,
  );
  const heading = screen.getByRole("heading", { level: 2, name: "General" });
  expect(heading).toHaveClass("p-heading--5");
  expect(heading.closest(".col-3")).not.toBeNull();
  expect(container.querySelector("section.row")).toHaveAttribute("aria-labelledby", "general");
  expect(screen.getByText("facts").closest(".col-9")).not.toBeNull();
});
