import { expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Section from "./Section";

const at = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Section title="General" id="general">
        <p>facts</p>
      </Section>
    </MemoryRouter>,
  );

test("a detail-page section is Incendio's overview row: small heading on the left, content beside it", () => {
  const { container } = at("/instances/x");
  const heading = screen.getByRole("heading", { level: 2, name: "General" });
  expect(heading).toHaveClass("p-heading--5");
  expect(heading.closest(".col-3")).not.toBeNull();
  expect(container.querySelector("section.row")).toHaveAttribute("aria-labelledby", "general");
  expect(screen.getByText("facts").closest(".col-9")).not.toBeNull();
});

test("a link ending in #<id> scrolls to the section; another hash does not", () => {
  const scroll = vi.fn();
  Element.prototype.scrollIntoView = scroll;
  at("/instances/x#other");
  expect(scroll).not.toHaveBeenCalled();
  at("/instances/x#general");
  expect(scroll).toHaveBeenCalledWith({ block: "start" });
});
