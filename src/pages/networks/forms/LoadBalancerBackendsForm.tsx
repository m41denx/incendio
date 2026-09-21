import type { FC } from "react";
import {
  Button,
  Icon,
  Input,
  Label,
  Select,
} from "@canonical/react-components";
import type { FormikProps } from "formik/dist/types";
import type { LxdNetwork } from "types/network";
import type {
  LoadBalancerFormValues,
  LoadBalancerBackendFormValues,
  LoadBalancerPortFormValues,
} from "types/forms/loadBalancers";
import { focusField } from "util/formFields";
import { useSupportedFeatures } from "context/useSupportedFeatures";

interface Props {
  formik: FormikProps<LoadBalancerFormValues>;
  network: LxdNetwork;
}

const LoadBalancerBackendsForm: FC<Props> = ({ formik }) => {
  const { hasNetworkLoadBalancerHealthCheck } = useSupportedFeatures();
  const backends = formik.values.backends ?? [];
  const ports = formik.values.ports;

  // Formik types errors/touched of an optional array loosely, so narrow them.
  const backendErrorAt = (index: number) =>
    (
      formik.errors.backends as unknown as
        | (LoadBalancerBackendFormValues | undefined)[]
        | undefined
    )?.[index];
  const backendTouchedAt = (index: number) =>
    (
      formik.touched.backends as unknown as
        | (Record<string, boolean> | undefined)[]
        | undefined
    )?.[index];
  const portErrors = (index: number) =>
    formik.errors.ports?.[index] as LoadBalancerPortFormValues | null;

  const addBackend = () => {
    formik.setFieldValue("backends", [
      ...backends,
      {
        key: `added-${crypto.randomUUID()}`,
        name: "",
        targetAddress: "",
        targetPort: "",
        description: "",
      },
    ]);
    focusField(`backends.${backends.length}.name`);
  };

  const removeBackend = (index: number) => {
    const removed = backends[index]?.name;
    formik.setFieldValue(
      "backends",
      backends.filter((_, i) => i !== index),
    );
    // Clear any port that referenced the removed backend.
    formik.setFieldValue(
      "ports",
      ports.map((port) =>
        port.targetBackend === removed ? { ...port, targetBackend: "" } : port,
      ),
    );
  };

  const addPort = () => {
    formik.setFieldValue("ports", [
      ...ports,
      {
        key: `added-${crypto.randomUUID()}`,
        protocol: "tcp",
        listenPort: "",
        targetBackend: backends[0]?.name ?? "",
      },
    ]);
    focusField(`ports.${ports.length}.listenPort`);
  };

  const removePort = (index: number) => {
    formik.setFieldValue(
      "ports",
      ports.filter((_, i) => i !== index),
    );
  };

  const backendOptions = [
    { label: "Select a backend", value: "", disabled: true },
    ...backends
      .filter((backend) => backend.name)
      .map((backend) => ({ label: backend.name, value: backend.name })),
  ];

  return (
    <div className="load-balancer-backends">
      <h2 className="p-heading--5 u-no-margin--bottom">Backends</h2>
      <p className="u-text--muted">
        A backend points listen ports at a target address and port.
      </p>
      {backends.length > 0 && (
        <table className="u-no-margin--bottom load-balancer-backends-table">
          <thead>
            <tr>
              <th>
                <Label required forId="backends.0.name">
                  Name
                </Label>
              </th>
              <th>
                <Label required forId="backends.0.targetAddress">
                  Target address
                </Label>
              </th>
              <th>
                <Label required forId="backends.0.targetPort">
                  Target port
                </Label>
              </th>
              <th>Description</th>
              <th className="actions">
                <span className="u-off-screen">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {backends.map((backend, index) => (
              <tr key={backend.key}>
                <td>
                  <Input
                    {...formik.getFieldProps(`backends.${index}.name`)}
                    id={`backends.${index}.name`}
                    type="text"
                    required
                    placeholder="backend name"
                    error={
                      backendTouchedAt(index)?.name
                        ? backendErrorAt(index)?.name
                        : undefined
                    }
                  />
                </td>
                <td>
                  <Input
                    {...formik.getFieldProps(`backends.${index}.targetAddress`)}
                    id={`backends.${index}.targetAddress`}
                    type="text"
                    required
                    placeholder="10.0.0.10"
                    error={
                      backendTouchedAt(index)?.targetAddress
                        ? backendErrorAt(index)?.targetAddress
                        : undefined
                    }
                  />
                </td>
                <td>
                  <Input
                    {...formik.getFieldProps(`backends.${index}.targetPort`)}
                    id={`backends.${index}.targetPort`}
                    type="text"
                    required
                    placeholder="80 or 80,443"
                    error={
                      backendTouchedAt(index)?.targetPort
                        ? backendErrorAt(index)?.targetPort
                        : undefined
                    }
                  />
                </td>
                <td>
                  <Input
                    {...formik.getFieldProps(`backends.${index}.description`)}
                    id={`backends.${index}.description`}
                    type="text"
                    placeholder="Optional"
                  />
                </td>
                <td className="actions u-align--right">
                  <Button
                    appearance=""
                    hasIcon
                    type="button"
                    className="u-no-margin--bottom"
                    title="Remove backend"
                    onClick={() => {
                      removeBackend(index);
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
      <div>
        <Button hasIcon onClick={addBackend} type="button">
          <Icon name="plus" />
          <span>Add backend</span>
        </Button>
      </div>

      <h2 className="p-heading--5 u-no-margin--bottom">Ports</h2>
      <p className="u-text--muted">
        A port forwards a listen port to one of the backends above.
      </p>
      {ports.length > 0 && (
        <table className="u-no-margin--bottom load-balancer-ports">
          <thead>
            <tr>
              <th>
                <Label required forId="ports.0.listenPort">
                  Listen port
                </Label>
              </th>
              <th>
                <Label required forId="ports.0.protocol">
                  Protocol
                </Label>
              </th>
              <th>
                <Label required forId="ports.0.targetBackend">
                  Target backend
                </Label>
              </th>
              <th className="actions">
                <span className="u-off-screen">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {ports.map((port, index) => (
              <tr key={port.key}>
                <td>
                  <Input
                    {...formik.getFieldProps(`ports.${index}.listenPort`)}
                    id={`ports.${index}.listenPort`}
                    type="text"
                    required
                    placeholder="80 or 80,443"
                    error={
                      formik.touched.ports?.[index]?.listenPort
                        ? portErrors(index)?.listenPort
                        : undefined
                    }
                  />
                </td>
                <td>
                  <Select
                    {...formik.getFieldProps(`ports.${index}.protocol`)}
                    id={`ports.${index}.protocol`}
                    options={[
                      { label: "TCP", value: "tcp" },
                      { label: "UDP", value: "udp" },
                    ]}
                    aria-label={`Port ${index} protocol`}
                  />
                </td>
                <td>
                  <Select
                    {...formik.getFieldProps(`ports.${index}.targetBackend`)}
                    id={`ports.${index}.targetBackend`}
                    options={backendOptions}
                    aria-label={`Port ${index} target backend`}
                    error={
                      formik.touched.ports?.[index]?.targetBackend
                        ? portErrors(index)?.targetBackend
                        : undefined
                    }
                  />
                </td>
                <td className="actions u-align--right">
                  <Button
                    appearance=""
                    hasIcon
                    type="button"
                    className="u-no-margin--bottom"
                    title="Remove port"
                    onClick={() => {
                      removePort(index);
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
      <div>
        <Button hasIcon onClick={addPort} type="button">
          <Icon name="plus" />
          <span>Add port</span>
        </Button>
      </div>

      {hasNetworkLoadBalancerHealthCheck && (
        <>
          <h2 className="p-heading--5 u-no-margin--bottom">Health checks</h2>
          <p className="u-text--muted">
            Periodically probe backends and remove unhealthy ones from rotation.
          </p>
          <Input
            id="healthCheck"
            name="healthCheck"
            type="checkbox"
            label="Enable health checks"
            checked={formik.values.healthCheck ?? false}
            onChange={(e) => {
              formik.setFieldValue("healthCheck", e.target.checked);
            }}
          />
          {formik.values.healthCheck && (
            <>
              <Input
                {...formik.getFieldProps("healthCheckInterval")}
                id="healthCheckInterval"
                type="number"
                label="Interval (seconds)"
                placeholder="10"
              />
              <Input
                {...formik.getFieldProps("healthCheckTimeout")}
                id="healthCheckTimeout"
                type="number"
                label="Timeout (seconds)"
                placeholder="30"
              />
              <Input
                {...formik.getFieldProps("healthCheckSuccessCount")}
                id="healthCheckSuccessCount"
                type="number"
                label="Success count"
                help="Consecutive successful probes before a backend is marked healthy."
                placeholder="3"
              />
              <Input
                {...formik.getFieldProps("healthCheckFailureCount")}
                id="healthCheckFailureCount"
                type="number"
                label="Failure count"
                help="Consecutive failed probes before a backend is marked unhealthy."
                placeholder="3"
              />
            </>
          )}
        </>
      )}
    </div>
  );
};

export default LoadBalancerBackendsForm;
