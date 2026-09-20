import {
  getInstanceConfigKeys,
  getInstanceField,
  getProfileConfigKeys,
} from "util/instanceConfigFields";
import { isEmptyDevice, parseDevices } from "util/formDevices";
import type {
  BootFormValues,
  CloudInitFormValues,
  EditProfileFormValues,
  EditInstanceFormValues,
  MigrationFormValues,
  ProfileDetailsFormValues,
  ResourceLimitsFormValues,
  SecurityPoliciesFormValues,
  SnapshotFormValues,
  SshKeyFormValues,
  InstanceDetailsFormValues,
} from "types/forms/instanceAndProfile";
import type { LxdProfile } from "types/profile";
import type { LxdInstance } from "types/instance";
import type { LxdConfigPair } from "types/config";
import type { LxdProject } from "types/project";
import type { LxdStorageVolume } from "types/storage";
import { LOCAL_IMAGE, LOCAL_ISO } from "util/images";
import type { FormDevice } from "types/formDevice";
import { ISO_VOLUME_TYPE } from "util/devices";
import { type CpuLimit, type MemoryLimit, CPU_LIMIT_TYPE } from "types/limits";
import { parseCpuLimit, parseMemoryLimit } from "util/limits";
import { parseSshKeys } from "util/instanceEdit";
import {
  userPropertiesFromConfig,
  type UserPropertyFormValues,
} from "components/forms/UserPropertiesForm";

export const userPropPrefix = "user.";

export const getInstancePayload = (
  instance: LxdInstance,
  values: EditInstanceFormValues,
) => {
  const handledConfigKeys = getInstanceConfigKeys();
  const handledKeys = new Set([
    "name",
    "description",
    "type",
    "profiles",
    "devices",
    "config",
  ]);

  return {
    ...instanceEditDetailPayload(values),
    devices: formDeviceToPayload(values.devices),
    config: {
      ...instanceEditConfigPayload(values),
      ...resourceLimitsPayload(values),
      ...securityPoliciesPayload(values),
      ...snapshotsPayload(values),
      ...migrationPayload(values),
      ...bootPayload(values),
      ...cloudInitPayload(values),
      ...sshKeyPayload(values),
      ...getUnhandledKeyValues(instance.config, handledConfigKeys),
      ...userPropertiesPayload(instance.config, values),
    },
    ...getUnhandledKeyValues(instance, handledKeys),
  };
};

export const instanceEditDetailPayload = (values: EditInstanceFormValues) => {
  return {
    name: values.name,
    description: values.description,
    type: values.instanceType,
    profiles: values.profiles,
  };
};

export const formDeviceToPayload = (devices: FormDevice[]) => {
  return devices
    .filter((item) => !isEmptyDevice(item))
    .reduce((obj, { name, ...item }) => {
      if (
        item.type === "unknown" ||
        item.type === "custom-nic" ||
        item.type === ISO_VOLUME_TYPE
      ) {
        return {
          ...obj,
          [name]: item.bare,
        };
      }
      if (item.type === "nic") {
        if (item.parent && item.parent != "") {
          delete item.network;
          return {
            ...obj,
            [name]: item,
          };
        }
        delete item.parent;
        delete item.nictype;
        return {
          ...obj,
          [name]: item,
        };
      }
      if (item.type === "disk") {
        const { bare, ...rest } = item;
        item = { ...bare, ...rest };
      }
      if ("size" in item && !item.size?.match(/^\d/)) {
        delete item.size;
      }
      return {
        ...obj,
        [name]: item,
      };
    }, {});
};

export const instanceEditConfigPayload = (values: EditInstanceFormValues) => {
  return {
    [getInstanceField("placement_group")]: values.placement_group,
  };
};

export const resourceLimitsPayload = (values: ResourceLimitsFormValues) => {
  return {
    [getInstanceField("limits_cpu")]: cpuLimitToPayload(values.limits_cpu),
    [getInstanceField("limits_memory")]: memoryLimitToPayload(
      values.limits_memory,
    ),
    [getInstanceField("limits_memory_swap")]: values.limits_memory_swap,
    [getInstanceField("limits_disk_priority")]:
      values.limits_disk_priority?.toString(),
    [getInstanceField("limits_processes")]: values.limits_processes?.toString(),
    [getInstanceField("limits_cpu_allowance")]: values.limits_cpu_allowance,
    [getInstanceField("limits_cpu_nodes")]: values.limits_cpu_nodes,
    [getInstanceField("limits_cpu_priority")]: values.limits_cpu_priority,
    [getInstanceField("limits_hugepages_1GB")]: values.limits_hugepages_1GB,
    [getInstanceField("limits_hugepages_1MB")]: values.limits_hugepages_1MB,
    [getInstanceField("limits_hugepages_2MB")]: values.limits_hugepages_2MB,
    [getInstanceField("limits_hugepages_64KB")]: values.limits_hugepages_64KB,
    [getInstanceField("limits_memory_enforce")]: values.limits_memory_enforce,
    [getInstanceField("limits_memory_hotplug")]: values.limits_memory_hotplug,
    [getInstanceField("limits_memory_hugepages")]:
      values.limits_memory_hugepages,
    [getInstanceField("limits_memory_oom_priority")]:
      values.limits_memory_oom_priority,
    [getInstanceField("limits_memory_swap_priority")]:
      values.limits_memory_swap_priority,
  };
};

export const cpuLimitToPayload = (
  cpuLimit: CpuLimit | string | undefined,
): string | undefined => {
  if (!cpuLimit) {
    return undefined;
  }
  if (typeof cpuLimit === "string") {
    return cpuLimit;
  }
  switch (cpuLimit.selectedType) {
    case CPU_LIMIT_TYPE.DYNAMIC:
      return cpuLimit.dynamicValue?.toString();
    case CPU_LIMIT_TYPE.FIXED:
      if (
        cpuLimit.fixedValue?.includes(",") ||
        cpuLimit.fixedValue?.includes("-")
      ) {
        return cpuLimit.fixedValue;
      }
      if (cpuLimit.fixedValue) {
        const singleValue = +cpuLimit.fixedValue;
        return `${singleValue}-${singleValue}`;
      }
      return undefined;
  }
};

export const memoryLimitToPayload = (
  memoryLimit: MemoryLimit | undefined | string,
): string | undefined => {
  if (typeof memoryLimit === "string") {
    return memoryLimit;
  }
  if (!memoryLimit?.value) {
    return undefined;
  }
  return `${memoryLimit.value}${memoryLimit.unit}`;
};

export const securityPoliciesPayload = (values: SecurityPoliciesFormValues) => {
  return {
    [getInstanceField("security_protection_delete")]:
      values.security_protection_delete,
    [getInstanceField("security_privileged")]: values.security_privileged,
    [getInstanceField("security_nesting")]: values.security_nesting,
    [getInstanceField("security_protection_shift")]:
      values.security_protection_shift,
    [getInstanceField("security_idmap_base")]: values.security_idmap_base,
    [getInstanceField("security_idmap_size")]:
      values.security_idmap_size?.toString(),
    [getInstanceField("security_idmap_isolated")]:
      values.security_idmap_isolated,
    [getInstanceField("security_devlxd")]: values.security_devlxd,
    [getInstanceField("security_devlxd_images")]: values.security_devlxd_images,
    [getInstanceField("security_secureboot")]: values.security_secureboot,
    [getInstanceField("security_csm")]: values.security_csm,
    [getInstanceField("security_iommu")]: values.security_iommu,
    [getInstanceField("security_sev")]: values.security_sev,
    [getInstanceField("security_sev_policy_es")]: values.security_sev_policy_es,
    [getInstanceField("security_agent_metrics")]: values.security_agent_metrics,
    [getInstanceField("security_protection_start")]:
      values.security_protection_start,
    [getInstanceField("security_bpffs_delegate_attachs")]:
      values.security_bpffs_delegate_attachs,
    [getInstanceField("security_bpffs_delegate_cmds")]:
      values.security_bpffs_delegate_cmds,
    [getInstanceField("security_bpffs_delegate_maps")]:
      values.security_bpffs_delegate_maps,
    [getInstanceField("security_bpffs_delegate_progs")]:
      values.security_bpffs_delegate_progs,
    [getInstanceField("security_bpffs_path")]: values.security_bpffs_path,
    [getInstanceField("security_selinux_domain")]:
      values.security_selinux_domain,
    [getInstanceField("security_selinux_label_rootfs")]:
      values.security_selinux_label_rootfs,
    [getInstanceField("security_selinux_level")]: values.security_selinux_level,
    [getInstanceField("security_selinux_type")]: values.security_selinux_type,
    [getInstanceField("security_sev_session_data")]:
      values.security_sev_session_data,
    [getInstanceField("security_sev_session_dh")]:
      values.security_sev_session_dh,
    [getInstanceField("security_syscalls_allow")]:
      values.security_syscalls_allow,
    [getInstanceField("security_syscalls_deny")]: values.security_syscalls_deny,
    [getInstanceField("security_syscalls_deny_compat")]:
      values.security_syscalls_deny_compat,
    [getInstanceField("security_syscalls_deny_default")]:
      values.security_syscalls_deny_default,
    [getInstanceField("security_syscalls_intercept_bpf")]:
      values.security_syscalls_intercept_bpf,
    [getInstanceField("security_syscalls_intercept_bpf_devices")]:
      values.security_syscalls_intercept_bpf_devices,
    [getInstanceField("security_syscalls_intercept_mknod")]:
      values.security_syscalls_intercept_mknod,
    [getInstanceField("security_syscalls_intercept_mount")]:
      values.security_syscalls_intercept_mount,
    [getInstanceField("security_syscalls_intercept_mount_allowed")]:
      values.security_syscalls_intercept_mount_allowed,
    [getInstanceField("security_syscalls_intercept_mount_fuse")]:
      values.security_syscalls_intercept_mount_fuse,
    [getInstanceField("security_syscalls_intercept_mount_shift")]:
      values.security_syscalls_intercept_mount_shift,
    [getInstanceField("security_syscalls_intercept_sched_setscheduler")]:
      values.security_syscalls_intercept_sched_setscheduler,
    [getInstanceField("security_syscalls_intercept_setxattr")]:
      values.security_syscalls_intercept_setxattr,
    [getInstanceField("security_syscalls_intercept_sysinfo")]:
      values.security_syscalls_intercept_sysinfo,
  };
};

export const snapshotsPayload = (values: SnapshotFormValues) => {
  return {
    [getInstanceField("snapshots_pattern")]: values.snapshots_pattern,
    [getInstanceField("snapshots_schedule_stopped")]:
      values.snapshots_schedule_stopped,
    [getInstanceField("snapshots_schedule")]: values.snapshots_schedule,
    [getInstanceField("snapshots_expiry")]: values.snapshots_expiry,
    [getInstanceField("snapshots_expiry_manual")]:
      values.snapshots_expiry_manual,
  };
};

export const migrationPayload = (values: MigrationFormValues) => {
  return {
    [getInstanceField("migration_stateful")]: values.migration_stateful,
    [getInstanceField("cluster_evacuate")]: values.cluster_evacuate,
    [getInstanceField("migration_incremental_memory")]:
      values.migration_incremental_memory,
    [getInstanceField("migration_incremental_memory_goal")]:
      values.migration_incremental_memory_goal,
    [getInstanceField("migration_incremental_memory_iterations")]:
      values.migration_incremental_memory_iterations,
  };
};

export const bootPayload = (values: BootFormValues) => {
  return {
    [getInstanceField("boot_autostart")]: values.boot_autostart?.toString(),
    [getInstanceField("boot_autostart_delay")]:
      values.boot_autostart_delay?.toString(),
    [getInstanceField("boot_autostart_priority")]:
      values.boot_autostart_priority?.toString(),
    [getInstanceField("boot_host_shutdown_timeout")]:
      values.boot_host_shutdown_timeout?.toString(),
    [getInstanceField("boot_mode")]: values.boot_mode?.toString(),
    [getInstanceField("boot_stop_priority")]:
      values.boot_stop_priority?.toString(),
    [getInstanceField("boot_autorestart")]: values.boot_autorestart,
    [getInstanceField("boot_host_shutdown_action")]:
      values.boot_host_shutdown_action,
  };
};

export const cloudInitPayload = (values: CloudInitFormValues) => {
  return {
    [getInstanceField("cloud_init_network_config")]:
      values.cloud_init_network_config,
    [getInstanceField("cloud_init_user_data")]: values.cloud_init_user_data,
    [getInstanceField("cloud_init_vendor_data")]: values.cloud_init_vendor_data,
  };
};

export const sshKeyPayload = (values: SshKeyFormValues) => {
  const result: Record<string, string | undefined> = {};

  values.cloud_init_ssh_keys?.forEach((record) => {
    result[`cloud-init.ssh-keys.${record.name}`] =
      `${record.user}:${record.fingerprint}`;
  });

  return result;
};

export const userPropertiesPayload = (
  config: Record<string, string | undefined>,
  values: EditInstanceFormValues,
) => {
  const result: Record<string, string | undefined> = Object.fromEntries(
    Object.entries(config)
      .filter(([k]) => k.startsWith(userPropPrefix))
      .map(([k]) => [k, undefined]),
  );

  const userProperties = values.userProperties;
  userProperties.forEach((item: UserPropertyFormValues) => {
    result[item.name] = item.value;
  });
  return result;
};

export const getUnhandledKeyValues = (
  item:
    | LxdConfigPair
    | LxdInstance
    | LxdProfile
    | LxdProject
    | LxdStorageVolume,
  handledKeys: Set<string>,
) => {
  return Object.fromEntries(
    Object.entries(item).filter(
      ([key]) =>
        !handledKeys.has(key) && !key.startsWith("cloud-init.ssh-keys."),
    ),
  );
};

export const getProfilePayload = (
  profile: LxdProfile,
  values: EditProfileFormValues,
) => {
  const handledConfigKeys = getProfileConfigKeys();
  const handledKeys = new Set(["name", "description", "devices", "config"]);

  return {
    ...profileDetailPayload(values),
    devices: formDeviceToPayload(values.devices),
    config: {
      ...profileDetailConfigPayload(values),
      ...resourceLimitsPayload(values),
      ...securityPoliciesPayload(values),
      ...snapshotsPayload(values),
      ...migrationPayload(values),
      ...bootPayload(values),
      ...cloudInitPayload(values),
      ...sshKeyPayload(values),
      ...getUnhandledKeyValues(profile.config, handledConfigKeys),
    },
    ...getUnhandledKeyValues(profile, handledKeys),
  };
};

export const profileDetailPayload = (values: ProfileDetailsFormValues) => {
  return {
    name: values.name,
    description: values.description,
  };
};

export const profileDetailConfigPayload = (
  values: ProfileDetailsFormValues,
) => {
  return {
    [getInstanceField("placement_group")]: values.placement_group,
  };
};

export const instanceDetailPayload = (
  values: InstanceDetailsFormValues,
  hasImageRegistries: boolean,
) => {
  return {
    name: values.name,
    description: values.description,
    type: values.instanceType,
    profiles: values.profiles,
    source: getInstanceSource(values, hasImageRegistries),
  };
};

const getInstanceSource = (
  values: InstanceDetailsFormValues,
  hasImageRegistries: boolean,
) => {
  if (values.image?.registryName && hasImageRegistries) {
    return {
      alias: values.image?.aliases.split(",")[0],
      mode: "pull",
      image_registry: values.image?.registryName,
      type: "image",
    };
  }

  if (values.image?.server === LOCAL_IMAGE || values.image?.cached) {
    return {
      type: "image",
      certificate: "",
      fingerprint: values.image?.fingerprint,
      allow_inconsistent: false,
    };
  }

  if (values.image?.server === LOCAL_ISO) {
    return {
      type: "none",
      certificate: "",
      allow_inconsistent: false,
    };
  }

  return {
    alias: values.image?.aliases.split(",")[0],
    mode: "pull",
    protocol: values.image?.protocol ? values.image?.protocol : "simplestreams",
    server: values.image?.server,
    type: "image",
  };
};

export const getInstanceEditValues = (
  instance: LxdInstance,
  editRestriction?: string,
): EditInstanceFormValues => {
  return {
    instanceType: instance.type,
    profiles: instance.profiles,
    location: instance.location,
    isCreating: false,
    readOnly: true,
    entityType: "instance",
    editRestriction,
    ...getEditValues(instance),
  };
};

export const getProfileEditValues = (
  profile: LxdProfile,
  editRestriction?: string,
): EditProfileFormValues => {
  return {
    readOnly: true,
    entityType: "profile",
    editRestriction,
    ...getEditValues(profile),
  };
};

const getEditValues = (
  item: LxdProfile | LxdInstance,
): Omit<EditProfileFormValues, "entityType" | "readOnly"> & {
  userProperties: UserPropertyFormValues[];
} => {
  const userProperties = userPropertiesFromConfig(item.config).map(
    ([key, value]) => ({
      name: key,
      value: value,
      nameEditable: false,
    }),
  ) as UserPropertyFormValues[];

  return {
    name: item.name,
    description: item.description,

    devices: parseDevices(item.devices),

    limits_cpu: parseCpuLimit(item.config["limits.cpu"]),
    limits_memory: parseMemoryLimit(item.config["limits.memory"]),
    limits_memory_swap: item.config["limits.memory.swap"],
    limits_disk_priority: item.config["limits.disk.priority"]
      ? parseInt(item.config["limits.disk.priority"])
      : undefined,
    limits_processes: item.config["limits.processes"]
      ? parseInt(item.config["limits.processes"])
      : undefined,
    limits_cpu_allowance: item.config["limits.cpu.allowance"],
    limits_cpu_nodes: item.config["limits.cpu.nodes"],
    limits_cpu_priority: item.config["limits.cpu.priority"],
    limits_hugepages_1GB: item.config["limits.hugepages.1GB"],
    limits_hugepages_1MB: item.config["limits.hugepages.1MB"],
    limits_hugepages_2MB: item.config["limits.hugepages.2MB"],
    limits_hugepages_64KB: item.config["limits.hugepages.64KB"],
    limits_memory_enforce: item.config["limits.memory.enforce"],
    limits_memory_hotplug: item.config["limits.memory.hotplug"],
    limits_memory_hugepages: item.config["limits.memory.hugepages"],
    limits_memory_oom_priority: item.config["limits.memory.oom_priority"],
    limits_memory_swap_priority: item.config["limits.memory.swap.priority"],

    placement_group: item.config["placement.group"],

    security_protection_delete: item.config["security.protection.delete"],
    security_privileged: item.config["security.privileged"],
    security_nesting: item.config["security.nesting"],
    security_protection_shift: item.config["security.protection.shift"],
    security_idmap_base: item.config["security.idmap.base"],
    security_idmap_size: item.config["security.idmap.size"]
      ? parseInt(item.config["security.idmap.size"])
      : undefined,
    security_idmap_isolated: item.config["security.idmap.isolated"],
    security_devlxd: item.config["security.guestapi"],
    security_devlxd_images: item.config["security.guestapi.images"],
    security_secureboot: item.config["security.secureboot"],
    security_csm: item.config["security.csm"],
    security_iommu: item.config["security.iommu"],
    security_sev: item.config["security.sev"],
    security_sev_policy_es: item.config["security.sev.policy.es"],
    security_agent_metrics: item.config["security.agent.metrics"],
    security_protection_start: item.config["security.protection.start"],
    security_bpffs_delegate_attachs:
      item.config["security.bpffs.delegate_attachs"],
    security_bpffs_delegate_cmds: item.config["security.bpffs.delegate_cmds"],
    security_bpffs_delegate_maps: item.config["security.bpffs.delegate_maps"],
    security_bpffs_delegate_progs: item.config["security.bpffs.delegate_progs"],
    security_bpffs_path: item.config["security.bpffs.path"],
    security_selinux_domain: item.config["security.selinux.domain"],
    security_selinux_label_rootfs:
      item.config["security.selinux.label_rootfs"],
    security_selinux_level: item.config["security.selinux.level"],
    security_selinux_type: item.config["security.selinux.type"],
    security_sev_session_data: item.config["security.sev.session.data"],
    security_sev_session_dh: item.config["security.sev.session.dh"],
    security_syscalls_allow: item.config["security.syscalls.allow"],
    security_syscalls_deny: item.config["security.syscalls.deny"],
    security_syscalls_deny_compat:
      item.config["security.syscalls.deny_compat"],
    security_syscalls_deny_default:
      item.config["security.syscalls.deny_default"],
    security_syscalls_intercept_bpf:
      item.config["security.syscalls.intercept.bpf"],
    security_syscalls_intercept_bpf_devices:
      item.config["security.syscalls.intercept.bpf.devices"],
    security_syscalls_intercept_mknod:
      item.config["security.syscalls.intercept.mknod"],
    security_syscalls_intercept_mount:
      item.config["security.syscalls.intercept.mount"],
    security_syscalls_intercept_mount_allowed:
      item.config["security.syscalls.intercept.mount.allowed"],
    security_syscalls_intercept_mount_fuse:
      item.config["security.syscalls.intercept.mount.fuse"],
    security_syscalls_intercept_mount_shift:
      item.config["security.syscalls.intercept.mount.shift"],
    security_syscalls_intercept_sched_setscheduler:
      item.config["security.syscalls.intercept.sched_setscheduler"],
    security_syscalls_intercept_setxattr:
      item.config["security.syscalls.intercept.setxattr"],
    security_syscalls_intercept_sysinfo:
      item.config["security.syscalls.intercept.sysinfo"],

    snapshots_pattern: item.config["snapshots.pattern"],
    snapshots_expiry: item.config["snapshots.expiry"],
    snapshots_expiry_manual: item.config["snapshots.expiry.manual"],
    snapshots_schedule: item.config["snapshots.schedule"],
    snapshots_schedule_stopped: item.config["snapshots.schedule.stopped"],

    migration_stateful: item.config["migration.stateful"],
    cluster_evacuate: item.config["cluster.evacuate"],
    migration_incremental_memory: item.config["migration.incremental.memory"],
    migration_incremental_memory_goal:
      item.config["migration.incremental.memory.goal"],
    migration_incremental_memory_iterations:
      item.config["migration.incremental.memory.iterations"],

    boot_autostart: item.config["boot.autostart"],
    boot_autostart_delay: item.config["boot.autostart.delay"],
    boot_autostart_priority: item.config["boot.autostart.priority"],
    boot_host_shutdown_timeout: item.config["boot.host_shutdown_timeout"],
    boot_mode: item.config["boot.mode"],
    boot_stop_priority: item.config["boot.stop.priority"],
    boot_autorestart: item.config["boot.autorestart"],
    boot_host_shutdown_action: item.config["boot.host_shutdown_action"],

    cloud_init_network_config: item.config["cloud-init.network-config"],
    cloud_init_user_data: item.config["cloud-init.user-data"],
    cloud_init_vendor_data: item.config["cloud-init.vendor-data"],
    cloud_init_ssh_keys: parseSshKeys(item),
    userProperties: userProperties,
  };
};
