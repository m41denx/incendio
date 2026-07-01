import type { ClusterSpecificValues } from "types/cluster";
import type { LxdStoragePool } from "types/storage";

export interface StoragePoolFormValues {
  barePool?: LxdStoragePool;
  ceph_cluster_name?: string;
  ceph_osd_pg_num?: string;
  ceph_osd_pool_name?: string;
  ceph_rbd_clone_copy?: string;
  ceph_rbd_du?: string;
  ceph_user_name?: string;
  ceph_rbd_features?: string;
  cephfs_cluster_name?: string;
  cephfs_create_missing?: string;
  cephfs_fscache?: string;
  cephfs_osd_pg_num?: string;
  cephfs_path?: string;
  cephfs_user_name?: string;
  cephobject_radosgw_endpoint?: string;
  cephobject_cluster_name?: string;
  cephobject_user_name?: string;
  cephobject_bucket_name_prefix?: string;
  description: string;
  driver: string;
  entityType: "storagePool";
  isCreating: boolean;
  name: string;
  readOnly: boolean;
  size?: string;
  sizePerClusterMember?: ClusterSpecificValues;
  source: string;
  sourcePerClusterMember?: ClusterSpecificValues;
  yaml?: string;
  zfs_clone_copy?: string;
  zfs_export?: string;
  zfs_pool_name?: string;
  zfsPoolNamePerClusterMember?: ClusterSpecificValues;
  editRestriction?: string;
}
