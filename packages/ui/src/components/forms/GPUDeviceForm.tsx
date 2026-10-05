import type { FC } from "react";
import {
  Button,
  Icon,
  Input,
  Notification,
  useNotify,
  Spinner,
} from "@canonical/react-components";
import type { LxdGPUDevice, LxdPhysicalGPUDevice } from "types/device";
import type { InstanceAndProfileFormikProps } from "types/forms/instanceAndProfileFormProps";
import { getInheritedGPUs } from "util/configInheritance";
import AttachGPUBtn from "components/forms/SelectGPUBtn";
import type { GpuCard } from "types/resources";
import ScrollableForm from "components/ScrollableForm";
import RenameDeviceInput from "components/forms/RenameDeviceInput";
import ConfigurationTable from "components/ConfigurationTable";
import type { MainTableRow } from "@canonical/react-components/dist/components/MainTable/MainTable";
import { getConfigurationRowBase } from "components/ConfigurationRow";
import {
  addNoneDevice,
  deduplicateName,
  findNoneDeviceIndex,
  removeDevice,
} from "util/formDevices";
import {
  getInheritedDeviceRow,
  getInheritedSourceRow,
} from "components/forms/InheritedDeviceRow";
import {
  deviceKeyToLabel,
  getExistingDeviceNames,
  getProfileFromSource,
} from "util/devices";
import { ensureEditMode } from "util/editMode";
import GPUDeviceInput from "components/forms/GPUDeviceInput";
import { useProfiles } from "context/useProfiles";
import { useSupportedFeatures } from "context/useSupportedFeatures";
import DocLink from "components/DocLink";
import DeviceName from "components/forms/DeviceName";
import { isDeviceModified } from "util/formChangeCount";

interface Props {
  formik: InstanceAndProfileFormikProps;
  project: string;
  target?: string;
}

const isValidClique = (value: string) =>
  value === "" || (/^\d+$/.test(value) && Number(value) <= 15);

const GPUDevicesForm: FC<Props> = ({ formik, project, target }) => {
  const notify = useNotify();
  const { hasGpuPhysicalClique } = useSupportedFeatures();

  const {
    data: profiles = [],
    isLoading: isProfileLoading,
    error: profileError,
  } = useProfiles(project);

  if (profileError) {
    notify.failure("Loading profiles failed", profileError);
  }

  const inheritedGPUs = getInheritedGPUs(formik.values, profiles);
  const existingDeviceNames = getExistingDeviceNames(formik.values, profiles);
  const addGPUCard = (card: GpuCard) => {
    const drmId = card.drm?.id ? card.drm.id.toString() : undefined;

    const copy = [...formik.values.devices];
    copy.push({
      type: "gpu",
      gputype: "physical",
      pci: card.pci_address,
      id: card.pci_address === undefined ? drmId : undefined,
      name: deduplicateName("gpu", 1, existingDeviceNames),
    });
    formik.setFieldValue("devices", copy);
  };

  const hasCustomGPU = formik.values.devices.some(
    (item) => item.type === "gpu",
  );

  const inheritedRows: MainTableRow[] = [];
  inheritedGPUs.forEach((item) => {
    const noneDeviceId = findNoneDeviceIndex(item.key, formik);
    const isNoneDevice = noneDeviceId !== -1;

    inheritedRows.push(
      getConfigurationRowBase({
        className: "no-border-top override-with-form",
        configuration: (
          <DeviceName
            name={item.key}
            hasChanges={isDeviceModified(formik, item.key)}
            isDetached={isNoneDevice}
          />
        ),
        inherited: null,
        override: isNoneDevice ? (
          <Button
            appearance="base"
            type="button"
            title="Reattach GPU"
            onClick={() => {
              ensureEditMode(formik);
              removeDevice(noneDeviceId, formik);
            }}
            className="has-icon u-no-margin--bottom"
          >
            <Icon name="connected"></Icon>
            <span>Reattach</span>
          </Button>
        ) : (
          <Button
            appearance="base"
            type="button"
            onClick={() => {
              ensureEditMode(formik);
              addNoneDevice(item.key, formik);
            }}
            className="has-icon u-no-margin--bottom"
            title={formik.values.editRestriction ?? "Detach GPU"}
            disabled={!!formik.values.editRestriction}
          >
            <Icon name="disconnect"></Icon>
            <span>Detach</span>
          </Button>
        ),
      }),
    );

    inheritedRows.push(
      getInheritedSourceRow({
        project,
        profile: getProfileFromSource(item.source),
        isDetached: isNoneDevice,
      }),
    );

    Object.keys(item.gpu).forEach((key) => {
      if (key === "name" || key === "type") {
        return;
      }

      inheritedRows.push(
        getInheritedDeviceRow({
          label: deviceKeyToLabel(key),
          inheritValue: item.gpu[key as keyof typeof item.gpu],
          readOnly: false,
          isDeactivated: isNoneDevice,
        }),
      );
    });
  });

  const customRows: MainTableRow[] = [];
  formik.values.devices.forEach((formDevice, index) => {
    if (formDevice.type !== "gpu") {
      return;
    }
    const device = formik.values.devices[index] as LxdGPUDevice;

    customRows.push(
      getConfigurationRowBase({
        className: "no-border-top custom-device-name",
        configuration: (
          <RenameDeviceInput
            name={device.name}
            index={index}
            setName={(name) => {
              ensureEditMode(formik);
              formik.setFieldValue(`devices.${index}.name`, name);
            }}
            disableReason={formik.values.editRestriction}
            formik={formik}
          />
        ),
        inherited: "",
        override: (
          <Button
            className="u-no-margin--top u-no-margin--bottom"
            onClick={() => {
              ensureEditMode(formik);
              removeDevice(index, formik);
            }}
            type="button"
            appearance="base"
            hasIcon
            dense
            title={formik.values.editRestriction ?? "Detach GPU"}
            disabled={!!formik.values.editRestriction}
          >
            <Icon name="disconnect" />
            <span>Detach</span>
          </Button>
        ),
      }),
    );

    Object.keys(device).forEach((key) => {
      if (
        key === "name" ||
        key === "type" ||
        key === "pci" ||
        key === "id" ||
        key === "vendorid" ||
        key === "productid" ||
        key === "nvidia.clique"
      ) {
        return;
      }

      customRows.push(
        getInheritedDeviceRow({
          label: deviceKeyToLabel(key),
          inheritValue: device[key as keyof typeof device],
          readOnly: false,
        }),
      );
    });

    customRows.push(
      getInheritedDeviceRow({
        label: "Identify by",
        inheritValue: (
          <GPUDeviceInput
            device={device}
            onChange={(identifier) => {
              ensureEditMode(formik);
              formik.setFieldValue(`devices.${index}.pci`, identifier.pci);
              formik.setFieldValue(`devices.${index}.id`, identifier.id);
              formik.setFieldValue(
                `devices.${index}.vendorid`,
                identifier.vendorid,
              );
              formik.setFieldValue(
                `devices.${index}.productid`,
                identifier.productid,
              );
            }}
            disableReason={formik.values.editRestriction}
          />
        ),
        readOnly: false,
      }),
    );

    // gputype defaults to physical when unset.
    const gpuType = (device as { gputype?: string }).gputype;
    if (hasGpuPhysicalClique && (gpuType ?? "physical") === "physical") {
      const cliqueId = `devices-${index}-nvidia-clique`;
      const clique = (device as LxdPhysicalGPUDevice)["nvidia.clique"] ?? "";
      customRows.push(
        getInheritedDeviceRow({
          label: "NVIDIA P2P clique",
          inheritValue: (
            <Input
              id={cliqueId}
              type="number"
              min={0}
              max={15}
              placeholder="None"
              value={clique}
              disabled={!!formik.values.editRestriction}
              title={formik.values.editRestriction}
              help="GPUs in the same clique (0-15) can use GPUDirect peer-to-peer in the guest."
              error={isValidClique(clique) ? undefined : "Enter 0 to 15"}
              onChange={(e) => {
                ensureEditMode(formik);
                // A dotted key: replace the device rather than a nested path.
                void formik.setFieldValue(`devices.${index}`, {
                  ...device,
                  "nvidia.clique": e.target.value || undefined,
                });
              }}
              className="u-no-margin--bottom"
            />
          ),
          readOnly: false,
          monoFont: false,
        }),
      );
    }
  });

  if (isProfileLoading) {
    return <Spinner className="u-loader" text="Loading..." />;
  }

  return (
    <ScrollableForm className="device-form">
      {/* hidden submit to enable enter key in inputs */}
      <Input type="submit" hidden value="Hidden input" />

      <Notification severity="information" title="GPU passthrough">
        Learn more about{" "}
        <DocLink docPath="/reference/devices_gpu/#devices-gpu">
          GPU devices
        </DocLink>{" "}
        and{" "}
        <DocLink docPath="/howto/container_gpu_passthrough_with_docker/#container-gpu-passthrough-with-docker">
          container GPU passthrough with Docker
        </DocLink>
      </Notification>

      {inheritedRows.length > 0 && (
        <div className="inherited-devices">
          <h2 className="p-heading--4">Inherited GPU devices</h2>
          <ConfigurationTable rows={inheritedRows} />
        </div>
      )}

      {hasCustomGPU && (
        <div className="custom-devices">
          <h2 className="p-heading--4 custom-devices-heading">
            Custom GPU devices
          </h2>
          <ConfigurationTable rows={customRows} />
        </div>
      )}

      <AttachGPUBtn
        onSelect={(card) => {
          ensureEditMode(formik);
          addGPUCard(card);
        }}
        disabledReason={formik.values.editRestriction}
        target={target}
      />
    </ScrollableForm>
  );
};
export default GPUDevicesForm;
