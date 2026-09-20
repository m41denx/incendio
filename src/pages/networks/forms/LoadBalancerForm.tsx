import { useEffect, type FC } from "react";
import {
  Button,
  Col,
  Form,
  Icon,
  Input,
  Label,
  Notification,
  OutputField,
  RadioInput,
  Row,
  useListener,
  useNotify,
} from "@canonical/react-components";
import type { FormikProps } from "formik/dist/types";
import * as Yup from "yup";
import type { LxdNetwork } from "types/network";
import { updateMaxHeight } from "util/updateMaxHeight";
import { testValidIp, testValidPort } from "util/networks";
import NotificationRow from "components/NotificationRow";
import ScrollableForm from "components/ScrollableForm";
import { focusField } from "util/formFields";
import type { LoadBalancerFormValues } from "types/forms/loadBalancers";
import LoadBalancerPortsForm from "pages/networks/forms/LoadBalancerPortsForm";
import LoadBalancerBackendsForm from "pages/networks/forms/LoadBalancerBackendsForm";
import type { LxdLoadBalancer } from "types/loadBalancers";
import { useSupportedFeatures } from "context/useSupportedFeatures";

export const toLoadBalancer = (
  values: LoadBalancerFormValues,
): LxdLoadBalancer => {
  // The presence of `backends` (Incus backend model) switches the payload
  // shape away from the LXD pool model.
  if (values.backends !== undefined) {
    return {
      listen_address: values.listenAddress,
      description: values.description,
      backends: values.backends.map((backend) => ({
        name: backend.name,
        description: backend.description ?? "",
        target_address: backend.targetAddress,
        target_port: backend.targetPort,
      })),
      ports: values.ports.map((port) => ({
        protocol: port.protocol,
        listen_port: port.listenPort.toString(),
        target_backend: port.targetBackend ? [port.targetBackend] : [],
      })),
    };
  }

  return {
    listen_address: values.listenAddress,
    description: values.description,
    ports: values.ports.map((port) => ({
      protocol: port.protocol,
      listen_port: port.listenPort.toString(),
      target_pool: port.targetPool,
    })),
  };
};

export const LoadBalancerSchema = Yup.object().shape({
  listenAddress: Yup.string()
    .test("valid-ip", "Invalid IP address", testValidIp)
    .required("Listen address is required"),
  ports: Yup.array().of(
    Yup.object().shape({
      listenPort: Yup.string()
        .test("valid-port", "Invalid port number", testValidPort)
        .required("Port required"),
      protocol: Yup.string().required("Protocol is required"),
      targetPool: Yup.string().required("Target pool is required"),
    }),
  ),
});

// Incus backend model: listen ports forward to named backends (addr:port).
// listen/target ports may be comma-delimited ranges, so they are only
// required (not single-port validated).
export const LoadBalancerBackendSchema = Yup.object().shape({
  listenAddress: Yup.string()
    .test("valid-ip", "Invalid IP address", testValidIp)
    .required("Listen address is required"),
  backends: Yup.array().of(
    Yup.object().shape({
      name: Yup.string().required("Name is required"),
      targetAddress: Yup.string()
        .test("valid-ip", "Invalid IP address", testValidIp)
        .required("Target address is required"),
      targetPort: Yup.string().required("Target port is required"),
    }),
  ),
  ports: Yup.array().of(
    Yup.object().shape({
      listenPort: Yup.string().required("Port required"),
      protocol: Yup.string().required("Protocol is required"),
      targetBackend: Yup.string().required("Target backend is required"),
    }),
  ),
});

interface Props {
  formik: FormikProps<LoadBalancerFormValues>;
  isEdit?: boolean;
  network: LxdNetwork;
}

const LoadBalancerForm: FC<Props> = ({ formik, isEdit, network }) => {
  const notify = useNotify();
  const { hasLoadBalancerPools } = useSupportedFeatures();
  // Incus uses the backend model; LXD uses load-balancer pools.
  const useBackends = !hasLoadBalancerPools;

  const updateFormHeight = () => {
    updateMaxHeight("form-contents", "p-bottom-controls");
  };
  useEffect(updateFormHeight, [notify.notification?.message]);
  useListener(window, updateFormHeight, "resize", true);

  const addPort = () => {
    formik.setFieldValue("ports", [
      ...formik.values.ports,
      {
        key: `added-${crypto.randomUUID()}`,
        protocol: "tcp",
        listenPort: "",
        targetPool: "",
      },
    ]);

    const listenPort = `ports.${formik.values.ports.length}.listenPort`;
    focusField(listenPort);
  };

  const isManualListenAddress = !["0.0.0.0", "::"].includes(
    formik.values.listenAddress,
  );
  const ipv4Address = network?.config["ipv4.address"];
  const ipv6Address = network?.config["ipv6.address"];

  return (
    <Form className="form load-balancer-form" onSubmit={formik.handleSubmit}>
      <ScrollableForm>
        {/* hidden submit to enable enter key in inputs */}
        <Input type="submit" hidden value="Hidden input" />
        <Row className="p-form__group p-form-validation">
          <NotificationRow />
          <Notification
            severity="information"
            title="Network information"
            titleElement="h2"
          >
            Name: {network?.name}
            <br />
            {ipv4Address && (
              <>
                IPv4: {ipv4Address}
                <br />
              </>
            )}
            {ipv6Address && <>IPv6: {ipv6Address}</>}
          </Notification>
        </Row>
        <Row>
          <Col size={4}>
            <Label>Listen address</Label>
          </Col>
          <Col size={8}>
            {isEdit ? (
              <OutputField
                id="listenAddress"
                label=""
                value={formik.values.listenAddress}
              />
            ) : (
              <>
                {ipv4Address !== "none" && (
                  <RadioInput
                    label="Auto-assign IPv4 address"
                    checked={formik.values.listenAddress === "0.0.0.0"}
                    onChange={() => {
                      formik.setFieldValue("listenAddress", "0.0.0.0");
                    }}
                  />
                )}
                {ipv6Address !== "none" && (
                  <RadioInput
                    label="Auto-assign IPv6 address"
                    checked={formik.values.listenAddress === "::"}
                    onChange={() => {
                      formik.setFieldValue("listenAddress", "::");
                    }}
                  />
                )}
                <RadioInput
                  label="Manually enter address"
                  checked={isManualListenAddress}
                  onChange={() => {
                    formik.setFieldValue("listenAddress", "");
                  }}
                />
                <Input
                  {...formik.getFieldProps("listenAddress")}
                  id="listenAddress"
                  type="text"
                  placeholder="Enter IP address"
                  disabled={!isManualListenAddress}
                  error={
                    formik.touched.listenAddress
                      ? formik.errors.listenAddress
                      : undefined
                  }
                />
              </>
            )}
          </Col>
        </Row>
        <Input
          {...formik.getFieldProps("description")}
          id="description"
          type="text"
          label="Description"
          placeholder="Enter description"
          stacked
        />
        {useBackends ? (
          <Row className="load-balancer-ports-row">
            <LoadBalancerBackendsForm formik={formik} network={network} />
          </Row>
        ) : (
          <>
            {formik.values.ports.length > 0 && (
              <Row className="load-balancer-ports-row">
                <LoadBalancerPortsForm formik={formik} network={network} />
              </Row>
            )}
            <div>
              <Button hasIcon onClick={addPort} type="button">
                <Icon name="plus" />
                <span>Add port</span>
              </Button>
            </div>
          </>
        )}
      </ScrollableForm>
    </Form>
  );
};

export default LoadBalancerForm;
