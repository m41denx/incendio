import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import EmptyList from "./EmptyList";

test("an empty list is Incendio's empty state: faded icon, title, text and an optional action", () => {
  const { container } = render(
    <EmptyList icon="pods" title="No instances found" action={<button>Create instance</button>}>
      Nothing here yet.
    </EmptyList>,
  );
  expect(container.querySelector(".empty-state .p-icon--pods.empty-state-icon")).not.toBeNull();
  expect(screen.getByText("No instances found")).toHaveClass("p-heading--4");
  expect(screen.getByText("Nothing here yet.").tagName).toBe("P");
  expect(screen.getByRole("button", { name: "Create instance" })).toBeInTheDocument();
});
