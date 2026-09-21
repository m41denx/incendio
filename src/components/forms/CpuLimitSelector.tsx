import type { FC } from "react";
import { Input, RadioInput } from "@canonical/react-components";
import { CPU_LIMIT_TYPE, type CpuLimit } from "types/limits";
import CpuLimitInput from "components/forms/CpuLimitInput";
import type { InstanceAndProfileFormikProps } from "types/forms/instanceAndProfileFormProps";
import type { CreateInstanceFormValues } from "types/forms/instanceAndProfile";

interface Props {
  cpuLimit?: CpuLimit;
  setCpuLimit: (cpuLimit: CpuLimit) => void;
  help?: string;
  formik: InstanceAndProfileFormikProps;
}

const CpuLimitSelector: FC<Props> = ({
  cpuLimit,
  setCpuLimit,
  help,
  formik,
}) => {
  if (!cpuLimit) {
    return null;
  }

  // Topology (sockets/cores/threads) is a VM-only feature. Profiles are
  // instance-type-agnostic, so offer it there too.
  const isProfile = formik.values.entityType === "profile";
  const showTopology =
    isProfile ||
    (formik.values as CreateInstanceFormValues).instanceType ===
      "virtual-machine";

  return (
    <div>
      <div className="cpu-limit-label">
        <RadioInput
          label="number"
          checked={cpuLimit.selectedType === CPU_LIMIT_TYPE.DYNAMIC}
          onChange={() => {
            setCpuLimit({ selectedType: CPU_LIMIT_TYPE.DYNAMIC });
          }}
        />
        <RadioInput
          label="fixed"
          checked={cpuLimit.selectedType === CPU_LIMIT_TYPE.FIXED}
          onChange={() => {
            setCpuLimit({ selectedType: CPU_LIMIT_TYPE.FIXED });
          }}
        />
        {showTopology && (
          <RadioInput
            label="topology"
            checked={cpuLimit.selectedType === CPU_LIMIT_TYPE.TOPOLOGY}
            onChange={() => {
              setCpuLimit({ selectedType: CPU_LIMIT_TYPE.TOPOLOGY });
            }}
          />
        )}
      </div>
      {cpuLimit.selectedType === CPU_LIMIT_TYPE.DYNAMIC && (
        <CpuLimitInput
          id="limits_cpu"
          name="limits_cpu"
          type="number"
          min="1"
          step="1"
          placeholder="Number of exposed cores"
          onChange={(e) => {
            setCpuLimit({ ...cpuLimit, dynamicValue: e.target.value });
          }}
          value={cpuLimit.dynamicValue ?? ""}
          help={help}
          formik={formik}
        />
      )}
      {cpuLimit.selectedType === CPU_LIMIT_TYPE.FIXED && (
        <CpuLimitInput
          id="limits_cpu"
          name="limits_cpu"
          type="text"
          placeholder="Comma-separated core numbers"
          onChange={(e) => {
            setCpuLimit({ ...cpuLimit, fixedValue: e.target.value });
          }}
          value={cpuLimit.fixedValue ?? ""}
          help={help}
          formik={formik}
        />
      )}
      {cpuLimit.selectedType === CPU_LIMIT_TYPE.TOPOLOGY && (
        <div className="u-flex u-gap--small cpu-topology-inputs">
          <Input
            id="limits_cpu_sockets"
            name="limits_cpu_sockets"
            label="Sockets"
            type="number"
            min="1"
            step="1"
            placeholder="e.g. 2"
            onChange={(e) => {
              setCpuLimit({ ...cpuLimit, sockets: e.target.value });
            }}
            value={cpuLimit.sockets ?? ""}
          />
          <Input
            id="limits_cpu_cores"
            name="limits_cpu_cores"
            label="Cores"
            type="number"
            min="1"
            step="1"
            placeholder="e.g. 4"
            onChange={(e) => {
              setCpuLimit({ ...cpuLimit, cores: e.target.value });
            }}
            value={cpuLimit.cores ?? ""}
          />
          <Input
            id="limits_cpu_threads"
            name="limits_cpu_threads"
            label="Threads"
            type="number"
            min="1"
            step="1"
            placeholder="e.g. 2"
            onChange={(e) => {
              setCpuLimit({ ...cpuLimit, threads: e.target.value });
            }}
            value={cpuLimit.threads ?? ""}
            help={help}
          />
        </div>
      )}
    </div>
  );
};

export default CpuLimitSelector;
