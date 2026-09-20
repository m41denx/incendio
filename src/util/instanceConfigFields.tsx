const instanceConfigFormFieldsToPayload: Record<string, string> = {
  rootStorage: "",
  limits_cpu: "limits.cpu",
  limits_memory: "limits.memory",
  limits_memory_swap: "limits.memory.swap",
  limits_disk_priority: "limits.disk.priority",
  limits_processes: "limits.processes",
  placement_group: "placement.group",
  security_privileged: "security.privileged",
  security_nesting: "security.nesting",
  security_protection_delete: "security.protection.delete",
  security_protection_shift: "security.protection.shift",
  security_idmap_base: "security.idmap.base",
  security_idmap_size: "security.idmap.size",
  security_idmap_isolated: "security.idmap.isolated",
  security_devlxd: "security.guestapi",
  security_devlxd_images: "security.guestapi.images",
  security_secureboot: "security.secureboot",
  security_csm: "security.csm",
  security_iommu: "security.iommu",
  security_sev: "security.sev",
  security_sev_policy_es: "security.sev.policy.es",
  security_agent_metrics: "security.agent.metrics",
  security_protection_start: "security.protection.start",
  security_bpffs_delegate_attachs: "security.bpffs.delegate_attachs",
  security_bpffs_delegate_cmds: "security.bpffs.delegate_cmds",
  security_bpffs_delegate_maps: "security.bpffs.delegate_maps",
  security_bpffs_delegate_progs: "security.bpffs.delegate_progs",
  security_bpffs_path: "security.bpffs.path",
  security_selinux_domain: "security.selinux.domain",
  security_selinux_label_rootfs: "security.selinux.label_rootfs",
  security_selinux_level: "security.selinux.level",
  security_selinux_type: "security.selinux.type",
  security_sev_session_data: "security.sev.session.data",
  security_sev_session_dh: "security.sev.session.dh",
  security_syscalls_allow: "security.syscalls.allow",
  security_syscalls_deny: "security.syscalls.deny",
  security_syscalls_deny_compat: "security.syscalls.deny_compat",
  security_syscalls_deny_default: "security.syscalls.deny_default",
  security_syscalls_intercept_bpf: "security.syscalls.intercept.bpf",
  security_syscalls_intercept_bpf_devices:
    "security.syscalls.intercept.bpf.devices",
  security_syscalls_intercept_mknod: "security.syscalls.intercept.mknod",
  security_syscalls_intercept_mount: "security.syscalls.intercept.mount",
  security_syscalls_intercept_mount_allowed:
    "security.syscalls.intercept.mount.allowed",
  security_syscalls_intercept_mount_fuse:
    "security.syscalls.intercept.mount.fuse",
  security_syscalls_intercept_mount_shift:
    "security.syscalls.intercept.mount.shift",
  security_syscalls_intercept_sched_setscheduler:
    "security.syscalls.intercept.sched_setscheduler",
  security_syscalls_intercept_setxattr:
    "security.syscalls.intercept.setxattr",
  security_syscalls_intercept_sysinfo: "security.syscalls.intercept.sysinfo",
  snapshots_pattern: "snapshots.pattern",
  snapshots_expiry: "snapshots.expiry",
  snapshots_schedule: "snapshots.schedule",
  snapshots_schedule_stopped: "snapshots.schedule.stopped",
  migration_stateful: "migration.stateful",
  cluster_evacuate: "cluster.evacuate",
  boot_autostart: "boot.autostart",
  boot_autostart_delay: "boot.autostart.delay",
  boot_autostart_priority: "boot.autostart.priority",
  boot_host_shutdown_timeout: "boot.host_shutdown_timeout",
  boot_mode: "boot.mode",
  boot_stop_priority: "boot.stop.priority",
  cloud_init_network_config: "cloud-init.network-config",
  cloud_init_user_data: "cloud-init.user-data",
  cloud_init_vendor_data: "cloud-init.vendor-data",
};

export const getInstanceField = (formField: string): string => {
  if (!(formField in instanceConfigFormFieldsToPayload)) {
    throw new Error(
      `Could not find ${formField} in instanceConfigFormFieldsToPayload`,
    );
  }
  return instanceConfigFormFieldsToPayload[formField];
};

const getConfigKeys = (): Set<string> => {
  return new Set(Object.values(instanceConfigFormFieldsToPayload));
};

export const getInstanceConfigKeys = getConfigKeys;

export const getProfileConfigKeys = getConfigKeys;
