import { useEffect, type FC } from "react";
import {
  Col,
  Form,
  Input,
  Notification,
  Row,
  useListener,
  useNotify,
} from "@canonical/react-components";
import type { FormikProps } from "formik";
import StoragePoolFormMain from "./StoragePoolFormMain";
import StoragePoolFormMenu, {
  CEPH_CONFIGURATION,
  CEPHFS_CONFIGURATION,
  CEPHOBJECT_CONFIGURATION,
  LINSTOR_CONFIGURATION,
  LVM_CONFIGURATION,
  MAIN_CONFIGURATION,
  YAML_CONFIGURATION,
  ZFS_CONFIGURATION,
} from "./StoragePoolFormMenu";
import { updateMaxHeight } from "util/updateMaxHeight";
import type { LxdStoragePool } from "types/storage";
import {
  cephObject,
  getSupportedStorageDrivers,
  linstorDriver,
  lvmDriver,
  zfsDriver,
} from "util/storageOptions";
import { getPoolKey, isCephDriver, isCephFSDriver } from "util/storagePool";
import { slugify } from "util/slugify";
import YamlForm from "components/forms/YamlForm";
import { handleConfigKeys } from "util/storagePoolForm";
import DocLink from "components/DocLink";
import StoragePoolFormCeph from "./StoragePoolFormCeph";
import StoragePoolFormZFS from "./StoragePoolFormZFS";
import StoragePoolFormLVM from "./StoragePoolFormLVM";
import StoragePoolFormLINSTOR from "./StoragePoolFormLINSTOR";
import { useSettings } from "context/useSettings";
import { ensureEditMode } from "util/editMode";
import StoragePoolFormCephFS from "pages/storage/forms/StoragePoolFormCephFS";
import StoragePoolFormCephObject from "./StoragePoolFormCephObject";
import { objectToYaml } from "util/yaml";
import type { StoragePoolFormValues } from "types/forms/storagePool";
import { useSupportedFeatures } from "context/useSupportedFeatures";

interface Props {
  formik: FormikProps<StoragePoolFormValues>;
  section: string;
  setSection: (section: string) => void;
  version?: number;
}

export const toStoragePool = (
  values: StoragePoolFormValues,
  hasRemoteDropSource: boolean,
): LxdStoragePool => {
  const isZFSDriver = values.driver === zfsDriver;
  const isCephObjectDriver = values.driver === cephObject;
  const isLVMDriver = values.driver === lvmDriver;
  const isLINSTORDriver = values.driver === linstorDriver;
  const hasValidSize = values.size?.match(/^\d/);

  const getConfig = () => {
    if (isCephDriver(values)) {
      return {
        [getPoolKey("ceph_cluster_name")]: values.ceph_cluster_name,
        [getPoolKey("ceph_osd_pg_num")]: values.ceph_osd_pg_num?.toString(),
        [getPoolKey("ceph_rbd_clone_copy")]: values.ceph_rbd_clone_copy,
        [getPoolKey("ceph_rbd_du")]: values.ceph_rbd_du,
        [getPoolKey("ceph_user_name")]: values.ceph_user_name,
        [getPoolKey("ceph_rbd_features")]: values.ceph_rbd_features,
        source: hasRemoteDropSource ? undefined : values.source,
        [getPoolKey("ceph_osd_pool_name")]: hasRemoteDropSource
          ? values.ceph_osd_pool_name
          : undefined,
      };
    }
    if (isCephFSDriver(values)) {
      return {
        [getPoolKey("cephfs_cluster_name")]: values.cephfs_cluster_name,
        [getPoolKey("cephfs_create_missing")]: values.cephfs_create_missing,
        [getPoolKey("cephfs_fscache")]: values.cephfs_fscache,
        [getPoolKey("cephfs_osd_pg_num")]: values.cephfs_osd_pg_num?.toString(),
        source: hasRemoteDropSource ? undefined : values.source,
        [getPoolKey("cephfs_path")]: hasRemoteDropSource
          ? values.cephfs_path
          : undefined,
      };
    }
    if (isCephObjectDriver) {
      return {
        [getPoolKey("cephobject_radosgw_endpoint")]:
          values.cephobject_radosgw_endpoint,
        [getPoolKey("cephobject_cluster_name")]: values.cephobject_cluster_name,
        [getPoolKey("cephobject_user_name")]: values.cephobject_user_name,
        [getPoolKey("cephobject_bucket_name_prefix")]:
          values.cephobject_bucket_name_prefix,
      };
    }
    if (isZFSDriver) {
      return {
        [getPoolKey("zfs_clone_copy")]: values.zfs_clone_copy ?? "",
        [getPoolKey("zfs_export")]: values.zfs_export ?? "",
        [getPoolKey("zfs_pool_name")]: values.zfs_pool_name,
        size: hasValidSize ? values.size : undefined,
      };
    }
    if (isLVMDriver) {
      return {
        [getPoolKey("lvm_vg_name")]: values.lvm_vg_name,
        [getPoolKey("lvm_thinpool_name")]: values.lvm_thinpool_name,
        [getPoolKey("lvm_use_thinpool")]: values.lvm_use_thinpool,
        [getPoolKey("lvm_metadata_size")]: values.lvm_metadata_size,
        [getPoolKey("lvm_thinpool_metadata_size")]:
          values.lvm_thinpool_metadata_size,
        [getPoolKey("lvm_vg_force_reuse")]: values.lvm_vg_force_reuse,
        size: hasValidSize ? values.size : undefined,
      };
    }
    if (isLINSTORDriver) {
      return {
        [getPoolKey("linstor_resource_group_name")]:
          values.linstor_resource_group_name,
        [getPoolKey("linstor_resource_group_place_count")]:
          values.linstor_resource_group_place_count,
        [getPoolKey("linstor_resource_group_storage_pool")]:
          values.linstor_resource_group_storage_pool,
        [getPoolKey("linstor_volume_prefix")]: values.linstor_volume_prefix,
        [getPoolKey("drbd_on_no_quorum")]: values.drbd_on_no_quorum,
        [getPoolKey("drbd_auto_add_quorum_tiebreaker")]:
          values.drbd_auto_add_quorum_tiebreaker,
        [getPoolKey("drbd_auto_diskful")]: values.drbd_auto_diskful,
      };
    }
    return {
      size: hasValidSize ? values.size : undefined,
    };
  };

  const excludeMainKeys = new Set([
    "used_by",
    "etag",
    "status",
    "locations",
    "config",
    "name",
    "description",
    "driver",
    "source",
  ]);
  const missingMainFields = Object.fromEntries(
    Object.entries(values.barePool ?? {}).filter(
      (e) => !excludeMainKeys.has(e[0]),
    ),
  );

  const excludeConfigKeys = new Set(handleConfigKeys);
  const missingConfigFields = Object.fromEntries(
    Object.entries(values.barePool?.config ?? {}).filter(
      (e) => !excludeConfigKeys.has(e[0]),
    ),
  );

  return {
    ...missingMainFields,
    name: values.name,
    description: values.description,
    driver: values.driver,
    config: {
      ...missingConfigFields,
      ...getConfig(),
      source: values.source,
    },
  };
};

const StoragePoolForm: FC<Props> = ({
  formik,
  section,
  setSection,
  version = 0,
}) => {
  const { data: settings } = useSettings();
  const notify = useNotify();
  const { hasRemoteDropSource } = useSupportedFeatures();

  const updateFormHeight = () => {
    updateMaxHeight("form-contents", "p-bottom-controls");
  };
  useEffect(updateFormHeight, [notify.notification?.message, section]);
  useListener(window, updateFormHeight, "resize", true);

  const getYaml = () => {
    const payload = toStoragePool(formik.values, hasRemoteDropSource);
    return objectToYaml(payload);
  };

  const supportedStorageDrivers = getSupportedStorageDrivers(settings);
  const isSupportedStorageDriver = supportedStorageDrivers.has(
    formik.values.driver,
  );

  return (
    <Form className="form storage-pool-form" onSubmit={formik.handleSubmit}>
      {/* hidden submit to enable enter key in inputs */}
      <Input type="submit" hidden value="Hidden input" />
      {section !== slugify(YAML_CONFIGURATION) && (
        <StoragePoolFormMenu
          active={section}
          setActive={setSection}
          formik={formik}
          isSupportedStorageDriver={isSupportedStorageDriver}
        />
      )}
      <Row className="form-contents" key={section}>
        <Col size={12}>
          {section === slugify(MAIN_CONFIGURATION) && (
            <StoragePoolFormMain formik={formik} />
          )}
          {section === slugify(CEPH_CONFIGURATION) && (
            <StoragePoolFormCeph formik={formik} />
          )}
          {section === slugify(CEPHFS_CONFIGURATION) && (
            <StoragePoolFormCephFS formik={formik} />
          )}
          {section === slugify(CEPHOBJECT_CONFIGURATION) && (
            <StoragePoolFormCephObject formik={formik} />
          )}
          {section === slugify(ZFS_CONFIGURATION) && (
            <StoragePoolFormZFS formik={formik} />
          )}
          {section === slugify(LVM_CONFIGURATION) && (
            <StoragePoolFormLVM formik={formik} />
          )}
          {section === slugify(LINSTOR_CONFIGURATION) && (
            <StoragePoolFormLINSTOR formik={formik} />
          )}
          {section === slugify(YAML_CONFIGURATION) && (
            <YamlForm
              key={`yaml-form-${version}`}
              yaml={getYaml()}
              setYaml={(yaml) => {
                ensureEditMode(formik);
                formik.setFieldValue("yaml", yaml);
              }}
              readOnly={!!formik.values.editRestriction}
              readOnlyMessage={formik.values.editRestriction}
            >
              <Notification severity="information" title="YAML Configuration">
                {`${isSupportedStorageDriver ? "" : `The ${formik.values.driver} driver is not fully supported in the web interface. `}This is the YAML representation of the storage pool.`}
                <br />
                <DocLink docPath="/explanation/storage/#storage-pools">
                  Learn more about storage pools
                </DocLink>
              </Notification>
            </YamlForm>
          )}
        </Col>
      </Row>
    </Form>
  );
};

export default StoragePoolForm;
