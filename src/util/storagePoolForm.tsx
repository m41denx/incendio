import type {
  LxdStoragePool,
  LXDStoragePoolOnClusterMember,
} from "types/storage";
import type { StoragePoolFormValues } from "types/forms/storagePool";
import type { ClusterSpecificValues } from "types/cluster";
import {
  zfsDriver,
  btrfsDriver,
  lvmDriver,
  dirDriver,
  cephDriver,
  cephFSDriver,
} from "util/storageOptions";
import type { ReactNode } from "react";
import type { FormikProps } from "formik";

export const isStoragePoolWithSize = (driver: string) => {
  const driversWithSize = [zfsDriver, lvmDriver, btrfsDriver];
  return driversWithSize.includes(driver);
};

export const isStoragePoolWithSource = (driver: string) => {
  const driversWithSource = [
    dirDriver,
    btrfsDriver,
    lvmDriver,
    zfsDriver,
    cephDriver,
    cephFSDriver,
  ];
  return driversWithSource.includes(driver);
};

export const toStoragePoolFormValues = (
  pool: LxdStoragePool,
  poolOnMembers?: LXDStoragePoolOnClusterMember[],
  editRestriction?: string,
): StoragePoolFormValues => {
  const sourcePerClusterMember: ClusterSpecificValues = {};
  const zfsPoolNamePerClusterMember: ClusterSpecificValues = {};
  const sizePerClusterMember: ClusterSpecificValues = {};

  poolOnMembers?.forEach((item) => {
    if (isStoragePoolWithSize(item.driver)) {
      sizePerClusterMember[item.memberName] = item.config?.size ?? "";
    }
    sourcePerClusterMember[item.memberName] = item.config?.source ?? "";
    zfsPoolNamePerClusterMember[item.memberName] =
      item.config?.["zfs.pool_name"] ?? "";
  });

  return {
    barePool: pool,
    ceph_cluster_name: pool.config?.["ceph.cluster_name"],
    ceph_osd_pg_num: pool.config?.["ceph.osd.pg_num"],
    ceph_rbd_clone_copy: pool.config?.["ceph.rbd.clone_copy"],
    ceph_rbd_du: pool.config?.["ceph.rbd.du"],
    ceph_user_name: pool.config?.["ceph.user.name"],
    ceph_rbd_features: pool.config?.["ceph.rbd.features"],
    cephfs_cluster_name: pool.config?.["cephfs.cluster_name"],
    cephfs_create_missing: pool.config?.["cephfs.create_missing"],
    cephfs_fscache: pool.config?.["cephfs.fscache"],
    cephfs_osd_pg_num: pool.config?.["cephfs.osd_pg_num"],
    cephfs_path: pool.config?.["cephfs.path"],
    cephfs_user_name: pool.config?.["cephfs.user.name"],
    cephobject_radosgw_endpoint: pool.config?.["cephobject.radosgw.endpoint"],
    cephobject_cluster_name: pool.config?.["cephobject.cluster_name"],
    cephobject_user_name: pool.config?.["cephobject.user.name"],
    cephobject_bucket_name_prefix:
      pool.config?.["cephobject.bucket.name_prefix"],
    description: pool.description,
    driver: pool.driver,
    entityType: "storagePool",
    isCreating: false,
    name: pool.name,
    readOnly: true,
    size: pool.config?.size || "GiB",
    sizePerClusterMember,
    source: pool.config?.source || "",
    sourcePerClusterMember,
    zfs_clone_copy: pool.config?.["zfs.clone_copy"],
    zfs_export: pool.config?.["zfs.export"],
    zfs_pool_name: pool.config?.["zfs.pool_name"],
    zfsPoolNamePerClusterMember,
    editRestriction,
  };
};

export const handleConfigKeys = [
  "size",
  "source",
  "ceph.cluster_name",
  "ceph.osd.pg_num",
  "ceph.rbd.clone_copy",
  "ceph.user.name",
  "ceph.rbd.features",
  "zfs.clone_copy",
  "zfs.export",
  "zfs.pool_name",
];

export const getFormProps = (
  formik: FormikProps<StoragePoolFormValues>,
  id: "name" | "description" | "size" | "source",
) => {
  return {
    id: id,
    name: id,
    onBlur: formik.handleBlur,
    onChange: formik.handleChange,
    value: formik.values[id],
    error: formik.touched[id] ? (formik.errors[id] as ReactNode) : null,
    placeholder: `Enter ${id.replaceAll("_", " ")}`,
  };
};
