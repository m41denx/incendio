import type { InstanceIconType } from "types/instance";
import type { RemoteImage } from "types/image";
import type { CpuLimit, MemoryLimit } from "types/limits";
import type { FormDevice } from "types/formDevice";
import type { UserPropertyFormValues } from "components/forms/UserPropertiesForm";

export interface BootFormValues {
  boot_autostart?: string;
  boot_autostart_delay?: string;
  boot_autostart_priority?: string;
  boot_host_shutdown_timeout?: string;
  boot_mode?: string;
  boot_stop_priority?: string;
  boot_autorestart?: string;
  boot_host_shutdown_action?: string;
}

export interface CloudInitFormValues {
  cloud_init_network_config?: string;
  cloud_init_user_data?: string;
  cloud_init_vendor_data?: string;
}

export type CloudInitKey = keyof CloudInitFormValues;

export interface FormDeviceValues {
  devices: FormDevice[];
}

export interface InstanceDetailsFormValues {
  name?: string;
  description?: string;
  image?: RemoteImage;
  instanceType: InstanceIconType;
  profiles: string[];
  target?: string;
  placementGroup?: string;
  entityType: "instance";
  isCreating: boolean;
  readOnly: boolean;
  editRestriction?: string;
}

export interface InstanceEditDetailsFormValues {
  name: string;
  description?: string;
  instanceType: string;
  location: string;
  placement_group?: string;
  profiles: string[];
  entityType: "instance";
  isCreating: boolean;
  readOnly: boolean;
  editRestriction?: string;
  userProperties: UserPropertyFormValues[];
}

export interface InstanceRestrictionFormValues {
  restricted_virtual_machines_low_level?: string;
  restricted_containers_low_level?: string;
  restricted_containers_nesting?: string;
  restricted_containers_privilege?: string;
  restricted_container_interception?: string;
  restrict_backups?: string;
  restrict_snapshots?: string;
  restricted_idmap_uid?: string;
  restricted_idmap_gid?: string;
}

export interface MigrationFormValues {
  migration_stateful?: string;
  cluster_evacuate?: string;
  migration_incremental_memory?: string;
  migration_incremental_memory_goal?: string;
  migration_incremental_memory_iterations?: string;
}

export interface ProfileDetailsFormValues {
  name: string;
  description?: string;
  entityType: "profile";
  placement_group?: string;
  readOnly: boolean;
  editRestriction?: string;
}

export interface ResourceLimitsFormValues {
  limits_cpu?: CpuLimit;
  limits_memory?: MemoryLimit;
  limits_memory_swap?: string;
  limits_disk_priority?: number;
  limits_processes?: number;
  limits_cpu_allowance?: string;
  limits_cpu_nodes?: string;
  limits_cpu_priority?: string;
  limits_hugepages_1GB?: string;
  limits_hugepages_1MB?: string;
  limits_hugepages_2MB?: string;
  limits_hugepages_64KB?: string;
  limits_memory_enforce?: string;
  limits_memory_hotplug?: string;
  limits_memory_hugepages?: string;
  limits_memory_oom_priority?: string;
  limits_memory_swap_priority?: string;
}

export interface SecurityPoliciesFormValues {
  security_protection_delete?: string;
  security_privileged?: string;
  security_nesting?: string;
  security_protection_shift?: string;
  security_idmap_base?: string;
  security_idmap_size?: number;
  security_idmap_isolated?: string;
  security_devlxd?: string;
  security_devlxd_images?: string;
  security_secureboot?: string;
  security_csm?: string;
  security_iommu?: string;
  security_sev?: string;
  security_sev_policy_es?: string;
  security_agent_metrics?: string;
  security_protection_start?: string;
  security_bpffs_delegate_attachs?: string;
  security_bpffs_delegate_cmds?: string;
  security_bpffs_delegate_maps?: string;
  security_bpffs_delegate_progs?: string;
  security_bpffs_path?: string;
  security_selinux_domain?: string;
  security_selinux_label_rootfs?: string;
  security_selinux_level?: string;
  security_selinux_type?: string;
  security_sev_session_data?: string;
  security_sev_session_dh?: string;
  security_syscalls_allow?: string;
  security_syscalls_deny?: string;
  security_syscalls_deny_compat?: string;
  security_syscalls_deny_default?: string;
  security_syscalls_intercept_bpf?: string;
  security_syscalls_intercept_bpf_devices?: string;
  security_syscalls_intercept_mknod?: string;
  security_syscalls_intercept_mount?: string;
  security_syscalls_intercept_mount_allowed?: string;
  security_syscalls_intercept_mount_fuse?: string;
  security_syscalls_intercept_mount_shift?: string;
  security_syscalls_intercept_sched_setscheduler?: string;
  security_syscalls_intercept_setxattr?: string;
  security_syscalls_intercept_sysinfo?: string;
}

export interface SnapshotFormValues {
  snapshots_pattern?: string;
  snapshots_expiry?: string;
  snapshots_expiry_manual?: string;
  snapshots_schedule?: string;
  snapshots_schedule_stopped?: string;
}

export interface SshKey {
  id: string;
  name: string;
  user: string;
  fingerprint: string;
}

export interface SshKeyFormValues {
  cloud_init_ssh_keys: SshKey[];
}

export interface YamlFormValues {
  yaml?: string;
}

export type CreateInstanceFormValues = InstanceDetailsFormValues &
  FormDeviceValues &
  ResourceLimitsFormValues &
  SecurityPoliciesFormValues &
  SnapshotFormValues &
  MigrationFormValues &
  BootFormValues &
  CloudInitFormValues &
  SshKeyFormValues &
  YamlFormValues;

export type CreateProfileFormValues = ProfileDetailsFormValues &
  FormDeviceValues &
  ResourceLimitsFormValues &
  SecurityPoliciesFormValues &
  SnapshotFormValues &
  MigrationFormValues &
  BootFormValues &
  CloudInitFormValues &
  SshKeyFormValues &
  YamlFormValues;

export type EditInstanceFormValues = InstanceEditDetailsFormValues &
  FormDeviceValues &
  ResourceLimitsFormValues &
  SecurityPoliciesFormValues &
  SnapshotFormValues &
  MigrationFormValues &
  BootFormValues &
  CloudInitFormValues &
  SshKeyFormValues &
  YamlFormValues;

export type EditProfileFormValues = ProfileDetailsFormValues &
  FormDeviceValues &
  ResourceLimitsFormValues &
  SecurityPoliciesFormValues &
  SnapshotFormValues &
  MigrationFormValues &
  BootFormValues &
  CloudInitFormValues &
  SshKeyFormValues &
  YamlFormValues;

export type InstanceAndProfileFormValues =
  | CreateInstanceFormValues
  | EditInstanceFormValues
  | CreateProfileFormValues
  | EditProfileFormValues;
