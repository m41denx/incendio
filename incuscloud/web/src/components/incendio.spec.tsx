import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { useState } from "react";
import PageHeader from "@incendio/ui/components/PageHeader";
import Meter from "@incendio/ui/components/Meter";

test("Incendio's PageHeader and Meter render from packages/ui, on this app's React", () => {
  const Hooked = () => {
    const [n] = useState(3);
    return (
      <PageHeader>
        <PageHeader.Left>
          <PageHeader.Title>Clusters {n}</PageHeader.Title>
        </PageHeader.Left>
      </PageHeader>
    );
  };
  const { container } = render(
    <>
      <Hooked />
      <Meter percentage={40} text="4 of 10" />
    </>,
  );
  expect(screen.getByRole("heading", { name: "Clusters 3" })).toHaveClass("p-heading--4");
  expect(container.querySelector(".page-header .page-header__left")).not.toBeNull();
  expect(container.querySelector<HTMLElement>(".p-meter > div")!.style.width).toBe("max(40%, 5px)");
  expect(screen.getByText("4 of 10")).toBeInTheDocument();
});
