import { createContext, useContext, type ReactNode } from "react";
import type { CreateInstanceFormValues } from "types/forms/instanceAndProfile";

/**
 * What a host application embedding Incendio adds to the create instance
 * form: fields above its main configuration (where the instance goes), and
 * values to start from. Standalone Incendio provides none of it.
 */
export interface CreateInstanceExtension {
  header?: ReactNode;
  initialValues?: Partial<CreateInstanceFormValues>;
}

export const CreateInstanceExtensionContext =
  createContext<CreateInstanceExtension>({});

export const useCreateInstanceExtension = () =>
  useContext(CreateInstanceExtensionContext);
