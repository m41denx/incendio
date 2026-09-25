import { isClusteredServer } from "util/settings";
import { useSettings } from "./useSettings";

export const useSupportedFeatures = () => {
  const { data: settings, isLoading, error } = useSettings();
  const apiExtensions = new Set(settings?.api_extensions);

  const serverVersion = settings?.environment?.server_version;
  const serverMajor = parseInt(serverVersion?.split(".")[0] ?? "0");
  const serverMinor = parseInt(serverVersion?.split(".")[1] ?? "0");

  return {
    settings,
    isSettingsLoading: isLoading,
    settingsError: error,
    hasCustomVolumeIso: apiExtensions.has("custom_volume_iso"),
    hasProjectsNetworksZones: apiExtensions.has("projects_networks_zones"),
    hasStorageBuckets: apiExtensions.has("storage_buckets"),
    // Storage bucket backups (export/import) endpoints.
    hasStorageBucketBackup: apiExtensions.has("storage_bucket_backup"),
    hasStorageVolumeFiles: apiExtensions.has("file_storage_volume"),
    // Buckets on local (non-object) storage pools via core.storage_buckets_address.
    hasStorageBucketsLocal: apiExtensions.has("storage_buckets_local"),
    hasMetadataConfiguration: apiExtensions.has("metadata_configuration"),
    // Gates the server-wide GET /1.0/storage-volumes endpoint, which requires
    // the base `storage_volumes_all` extension. Incus (7.4) ships only
    // `storage_volumes_all_projects` (the all-projects PARAM on that endpoint)
    // but not the endpoint itself, so this stays false there and the UI falls
    // back to collecting volumes per pool. Gating on _all_projects made the UI
    // call the missing endpoint and 404.
    hasStorageVolumesAll: apiExtensions.has("storage_volumes_all"),
    hasLocalDocumentation:
      (!!serverVersion && serverMajor >= 5 && serverMinor >= 19) ||
      serverMajor > 5,
    hasDocumentationObject:
      (!!serverVersion && serverMajor >= 5 && serverMinor >= 20) ||
      serverMajor > 5,
    hasAccessManagement: apiExtensions.has("access_management"),
    hasAccessManagementTLS: apiExtensions.has("access_management_tls"),
    // Incus has no placement-groups API; Incendio emulates LXD's groups with
    // its own placement scriptlet (util/placementGroups.ts), which only
    // matters when there are cluster members to choose from.
    hasPlacementGroups:
      apiExtensions.has("instances_placement_scriptlet") &&
      isClusteredServer(settings),
    hasInstanceCreateStart: apiExtensions.has("instance_create_start"),
    hasInstanceImportConversion: apiExtensions.has(
      "instance_import_conversion",
    ),
    hasEntityTypeMetadata: apiExtensions.has(
      "metadata_configuration_entity_types",
    ),
    hasClusterInternalCustomVolumeCopy: apiExtensions.has(
      "cluster_internal_custom_volume_copy",
    ),
    hasEntitiesWithEntitlements: apiExtensions.has(
      "entities_with_entitlements",
    ),
    hasCloudInitSshKeys: apiExtensions.has("cloud_init_ssh_keys"),
    hasBackupMetadataVersion: apiExtensions.has("backup_metadata_version"),
    hasStorageAndProfileOperations: apiExtensions.has(
      "storage_and_profile_operations",
    ),
    hasProjectForceDelete: apiExtensions.has("projects_force_delete"),
    hasInstanceForceDelete: apiExtensions.has("instance_force_delete"),
    hasInstanceBootMode: apiExtensions.has("instance_boot_mode"),
    hasInstanceStateSelectiveRecursion: apiExtensions.has(
      "instances_state_selective_recursion",
    ),
    hasProjectDeleteOperation: apiExtensions.has("project_delete_operation"),
    hasRemoteDropSource: apiExtensions.has("storage_remote_drop_source"),
    hasClusteringControlPlane: apiExtensions.has("clustering_control_plane"),
    hasStorageAndNetworkOperations: apiExtensions.has(
      "storage_and_network_operations",
    ),
    hasImageRegistries: apiExtensions.has("image_registries"),
    hasBulkOperations: apiExtensions.has("bulk_operations"),
    hasClusterLinks: apiExtensions.has("cluster_links"),
    hasReplicators: apiExtensions.has("replicators"),
    hasLoadBalancerPools: apiExtensions.has("network_load_balancer_pool"),
    hasStorageNvmeTcp: apiExtensions.has("storage_nvme_tcp"),
    hasLoadBalancerHealthChecks: apiExtensions.has(
      "network_load_balancer_pool_health_checks",
    ),
    // Incus-only: OVN interconnect network integrations.
    hasNetworkIntegrations: apiExtensions.has("network_integrations"),
    // Named IP/CIDR/range groups usable in ACL rules.
    hasNetworkAddressSets: apiExtensions.has("network_address_set"),
    // Incus network load balancers (backend model). LXD's load-balancer
    // *pools* (hasLoadBalancerPools) are a separate, LXD-only feature.
    hasNetworkLoadBalancers: apiExtensions.has("network_load_balancer"),
    hasNetworkLoadBalancerHealthCheck: apiExtensions.has(
      "network_load_balancer_health_check",
    ),
    hasNetworkLoadBalancerState: apiExtensions.has(
      "network_load_balancer_state",
    ),
    // Network DNS zones (+ records).
    hasNetworkZones: apiExtensions.has("network_dns"),
    hasNetworkZoneRecords: apiExtensions.has("network_dns_records"),
    // dns.nameservers on bridged/OVN networks.
    hasNetworkDnsNameservers: apiExtensions.has("network_dns_nameservers"),
    // VGA console screenshots for VMs.
    hasConsoleScreenshot: apiExtensions.has("instance_console_screenshot"),
    // UEFI/NVRAM variable management endpoints for VMs.
    hasInstanceNvram: apiExtensions.has("instance_nvram"),
    // raw.qemu.scriptlet instance config key.
    hasQemuScriptlet: apiExtensions.has("qemu_scriptlet"),
    // raw.qemu.qmp.* instance config keys.
    hasQemuRawQmp: apiExtensions.has("qemu_raw_qmp"),
    // raw.qemu.conf instance config key.
    hasQemuRawConf: apiExtensions.has("qemu_raw_conf"),
    // Named server logging targets (logging.<name>.*).
    hasServerLogging: apiExtensions.has("server_logging"),
    // Webhook logging target type.
    hasServerLoggingWebhook: apiExtensions.has("server_logging_webhook"),
    // ACME certificate provisioning (acme.* server config).
    hasAcme: apiExtensions.has("acme"),
    // Automatic cluster re-balancing (cluster.rebalance.* server config).
    hasClusterRebalance: apiExtensions.has("cluster_rebalance"),
    // instances.placement.scriptlet server config.
    hasPlacementScriptlet: apiExtensions.has("instances_placement_scriptlet"),
    // Cluster group used_by list.
    hasClusterGroupUsedBy: apiExtensions.has("cluster_group_usedby"),
    // Read-only "who can access" list on instances (GET .../access).
    hasInstanceAccess: apiExtensions.has("instance_access"),
    // Read-only "who can access" list on projects (GET .../access).
    hasProjectAccess: apiExtensions.has("project_access"),
    // description field on trusted certificates.
    hasCertificateDescription: apiExtensions.has("certificate_description"),
  };
};
