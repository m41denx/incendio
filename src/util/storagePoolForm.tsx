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
  linstorDriver,
  truenasDriver,
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
    linstorDriver,
    truenasDriver,
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
    lvm_vg_name: pool.config?.["lvm.vg_name"],
    lvm_thinpool_name: pool.config?.["lvm.thinpool_name"],
    lvm_use_thinpool: pool.config?.["lvm.use_thinpool"],
    lvm_metadata_size: pool.config?.["lvm.metadata_size"],
    lvm_thinpool_metadata_size: pool.config?.["lvm.thinpool_metadata_size"],
    lvm_vg_force_reuse: pool.config?.["lvm.vg.force_reuse"],
    linstor_resource_group_name: pool.config?.["linstor.resource_group.name"],
    linstor_resource_group_place_count:
      pool.config?.["linstor.resource_group.place_count"],
    linstor_resource_group_storage_pool:
      pool.config?.["linstor.resource_group.storage_pool"],
    linstor_volume_prefix: pool.config?.["linstor.volume.prefix"],
    drbd_on_no_quorum: pool.config?.["drbd.on_no_quorum"],
    drbd_auto_add_quorum_tiebreaker:
      pool.config?.["drbd.auto_add_quorum_tiebreaker"],
    drbd_auto_diskful: pool.config?.["drbd.auto_diskful"],
    truenas_host: pool.config?.["truenas.host"],
    truenas_api_key: pool.config?.["truenas.api_key"],
    truenas_dataset: pool.config?.["truenas.dataset"],
    truenas_portal: pool.config?.["truenas.portal"],
    truenas_initiator: pool.config?.["truenas.initiator"],
    truenas_allow_insecure: pool.config?.["truenas.allow_insecure"],
    truenas_clone_copy: pool.config?.["truenas.clone_copy"],
    truenas_force_reuse: pool.config?.["truenas.force_reuse"],
    truenas_config: pool.config?.["truenas.config"],
    btrfs_create_options: pool.config?.["btrfs.create_options"],
    btrfs_mount_options: pool.config?.["btrfs.mount_options"],
    rsync_bwlimit: pool.config?.["rsync.bwlimit"],
    rsync_compression: pool.config?.["rsync.compression"],
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
  "lvm.vg_name",
  "lvm.thinpool_name",
  "lvm.use_thinpool",
  "lvm.metadata_size",
  "lvm.thinpool_metadata_size",
  "lvm.vg.force_reuse",
  "linstor.resource_group.name",
  "linstor.resource_group.place_count",
  "linstor.resource_group.storage_pool",
  "linstor.volume.prefix",
  "drbd.on_no_quorum",
  "drbd.auto_add_quorum_tiebreaker",
  "drbd.auto_diskful",
  "truenas.host",
  "truenas.api_key",
  "truenas.dataset",
  "truenas.portal",
  "truenas.initiator",
  "truenas.allow_insecure",
  "truenas.clone_copy",
  "truenas.force_reuse",
  "truenas.config",
  "btrfs.create_options",
  "btrfs.mount_options",
  "rsync.bwlimit",
  "rsync.compression",
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
