import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes, Link, useLocation, useSearchParams } from "react-router-dom";
import { expect, test } from "vitest";
import { Redirect, RenderAt } from "./RenderAt";

/** What Incendio's pages do: read and set query parameters, link to "?panel=…". */
const Page = () => {
  const [params, setParams] = useSearchParams();
  const at = useLocation();
  return (
    <>
      <span data-testid="seen">{at.pathname + at.search}</span>
      <span data-testid="filter">{params.get("filter") ?? ""}</span>
      <button onClick={() => setParams({ filter: "web" })}>filter</button>
      <Link to="?panel=create">create</Link>
    </>
  );
};
const Real = () => {
  const at = useLocation();
  return <span data-testid="real">{at.pathname + at.search}</span>;
};

const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Real />
      <Routes>
        <Route
          path="/inventory/:cluster/groups/cluster"
          element={
            <RenderAt path="/ui/cluster/groups">
              <Route path="/ui/cluster/groups" element={<Page />} />
            </RenderAt>
          }
        />
      </Routes>
    </MemoryRouter>,
  );

test("query parameters set inside a tab stay on the console URL, and the page sees them", () => {
  renderAt("/inventory/c1/groups/cluster");
  fireEvent.click(screen.getByText("filter"));
  expect(screen.getByTestId("real").textContent).toBe("/inventory/c1/groups/cluster?filter=web");
  expect(screen.getByTestId("seen").textContent).toBe("/ui/cluster/groups?filter=web");
  expect(screen.getByTestId("filter").textContent).toBe("web");
});

test("links to the page itself (panels) point at the console URL", () => {
  renderAt("/inventory/c1/groups/cluster?filter=x");
  expect(screen.getByTestId("filter").textContent).toBe("x");
  const create = screen.getByText("create");
  expect(create.getAttribute("href")).toBe("/inventory/c1/groups/cluster?panel=create");
  fireEvent.click(create);
  expect(screen.getByTestId("real").textContent).toBe("/inventory/c1/groups/cluster?panel=create");
});

test("redirects from old Incendio URLs keep their query parameters", () => {
  render(
    <MemoryRouter initialEntries={["/ui/all-projects/instances?search=web&panel=x"]}>
      <Real />
      <Routes>
        <Route path="/ui/all-projects/instances" element={<Redirect to="/all/instances" />} />
        <Route path="/all/instances" element={null} />
      </Routes>
    </MemoryRouter>,
  );
  expect(screen.getByTestId("real").textContent).toBe("/all/instances?search=web&panel=x");
});
