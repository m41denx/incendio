import { expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import FormModal from "./FormModal";

test("a disabled form does not submit, even by Enter (implicit submission)", () => {
  const onSubmit = vi.fn(async () => {});
  render(
    <FormModal title="T" submitLabel="Go" onSubmit={onSubmit} onClose={() => {}} submitDisabled>
      <input aria-label="Field" />
    </FormModal>,
  );
  fireEvent.submit(screen.getByLabelText("Field").closest("form")!);
  expect(onSubmit).not.toHaveBeenCalled();
});
