import type { FC } from "react";
import {
  ActionButton,
  Button,
  Icon,
  Input,
  Modal,
  Select,
} from "@canonical/react-components";
import { useFormik } from "formik";
import * as Yup from "yup";
import type { LxdNetworkZoneRecord } from "types/network";

interface RecordEntryFormValues {
  type: string;
  value: string;
  ttl: string;
}

interface RecordFormValues {
  name: string;
  description: string;
  entries: RecordEntryFormValues[];
}

const RECORD_TYPES = [
  "A",
  "AAAA",
  "CNAME",
  "MX",
  "NS",
  "PTR",
  "SRV",
  "TXT",
  "CAA",
];

interface Props {
  record?: LxdNetworkZoneRecord;
  onClose: () => void;
  onSubmit: (record: LxdNetworkZoneRecord) => void;
  isSaving: boolean;
}

const NetworkZoneRecordModal: FC<Props> = ({
  record,
  onClose,
  onSubmit,
  isSaving,
}) => {
  const isEditing = !!record;

  const formik = useFormik<RecordFormValues>({
    initialValues: {
      name: record?.name ?? "",
      description: record?.description ?? "",
      entries: (record?.entries ?? []).map((entry) => ({
        type: entry.type,
        value: entry.value,
        ttl: entry.ttl ? String(entry.ttl) : "",
      })),
    },
    validationSchema: Yup.object().shape({
      name: Yup.string().required("Name is required"),
    }),
    onSubmit: (values) => {
      onSubmit({
        name: values.name,
        description: values.description,
        entries: values.entries
          .filter((entry) => entry.type && entry.value)
          .map((entry) => ({
            type: entry.type,
            value: entry.value,
            ...(entry.ttl ? { ttl: Number(entry.ttl) } : {}),
          })),
        etag: record?.etag,
      });
    },
  });

  const addEntry = () => {
    formik.setFieldValue("entries", [
      ...formik.values.entries,
      { type: "A", value: "", ttl: "" },
    ]);
  };

  const removeEntry = (index: number) => {
    formik.setFieldValue(
      "entries",
      formik.values.entries.filter((_, i) => i !== index),
    );
  };

  return (
    <Modal
      close={onClose}
      title={isEditing ? `Edit record ${record?.name}` : "Add record"}
      buttonRow={
        <>
          <Button appearance="base" onClick={onClose} type="button">
            Cancel
          </Button>
          <ActionButton
            appearance="positive"
            loading={isSaving}
            disabled={isSaving || formik.values.name.length === 0}
            onClick={() => void formik.submitForm()}
            type="button"
          >
            {isEditing ? "Save" : "Add record"}
          </ActionButton>
        </>
      }
    >
      <Input
        id="record-name"
        name="name"
        type="text"
        label="Name"
        required
        disabled={isEditing}
        help={isEditing ? "Name cannot be changed" : "e.g. www or @"}
        value={formik.values.name}
        onChange={formik.handleChange}
        onBlur={formik.handleBlur}
        error={formik.touched.name ? formik.errors.name : undefined}
      />
      <Input
        id="record-description"
        name="description"
        type="text"
        label="Description"
        value={formik.values.description}
        onChange={formik.handleChange}
        onBlur={formik.handleBlur}
      />
      <h2 className="p-heading--5 u-no-margin--bottom">Entries</h2>
      {formik.values.entries.length > 0 && (
        <table className="u-no-margin--bottom">
          <thead>
            <tr>
              <th>Type</th>
              <th>Value</th>
              <th>TTL</th>
              <th className="u-align--right">
                <span className="u-off-screen">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {formik.values.entries.map((entry, index) => (
              <tr key={index}>
                <td>
                  <Select
                    id={`entries.${index}.type`}
                    name={`entries.${index}.type`}
                    options={RECORD_TYPES.map((type) => ({
                      label: type,
                      value: type,
                    }))}
                    value={entry.type}
                    onChange={formik.handleChange}
                    aria-label={`Entry ${index} type`}
                  />
                </td>
                <td>
                  <Input
                    id={`entries.${index}.value`}
                    name={`entries.${index}.value`}
                    type="text"
                    value={entry.value}
                    onChange={formik.handleChange}
                    placeholder="e.g. 192.0.2.1"
                    aria-label={`Entry ${index} value`}
                  />
                </td>
                <td>
                  <Input
                    id={`entries.${index}.ttl`}
                    name={`entries.${index}.ttl`}
                    type="number"
                    value={entry.ttl}
                    onChange={formik.handleChange}
                    placeholder="300"
                    aria-label={`Entry ${index} TTL`}
                  />
                </td>
                <td className="u-align--right">
                  <Button
                    appearance="base"
                    hasIcon
                    type="button"
                    title="Remove entry"
                    className="u-no-margin--bottom"
                    onClick={() => {
                      removeEntry(index);
                    }}
                  >
                    <Icon name="delete" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Button hasIcon type="button" onClick={addEntry}>
        <Icon name="plus" />
        <span>Add entry</span>
      </Button>
    </Modal>
  );
};

export default NetworkZoneRecordModal;
