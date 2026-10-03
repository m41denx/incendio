package service

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"slices"

	lxdAPI "github.com/canonical/lxd/shared/api"
	"github.com/canonical/lxd/shared/logger"
	cephTypes "github.com/canonical/microceph/microceph/api/types"
	microTypes "github.com/canonical/microcluster/v3/microcluster/types"
	"github.com/lxc/incus/v7/shared/api"

	"github.com/m41denx/incendio/firecloud/api/types"
	cloudClient "github.com/m41denx/incendio/firecloud/client"
	"github.com/m41denx/incendio/firecloud/multicast"
)

// SystemInformation represents all information Firecloud needs from a system in order to set it up as part of the Firecloud.
type SystemInformation struct {
	// ExistingServices is a map of cluster members for each service currently installed on the system.
	ExistingServices map[types.ServiceType]map[string]string

	// ClusterName is the name of the system in Firecloud.
	ClusterName string

	// ClusterAddress is the default cluster address used for Firecloud.
	ClusterAddress string

	// AvailableDisks is the list of disks available for use on the system.
	AvailableDisks map[string]api.ResourcesStorageDisk

	// AvailableUplinkInterfaces is the list of networks that can be used for the OVN uplink network.
	AvailableUplinkInterfaces map[string]api.Network

	// AvailableCephInterfaces is the list of networks that can be used for the Ceph cluster network.
	AvailableCephInterfaces map[string]DedicatedInterface

	// AvailableOVNInterfaces is the list of networks that can be used for an OVN underlay network.
	AvailableOVNInterfaces map[string]DedicatedInterface

	// AvailableFirecloudInterfaces is the list of networks that can be used for a Firecloud internal network.
	AvailableFirecloudInterfaces map[string]DedicatedInterface

	// LXDLocalConfig is the local configuration of LXD on this system.
	LXDLocalConfig map[string]any

	// LXDConfig is the cluster configuration of LXD on this system.
	LXDConfig map[string]any

	// CephConfig is the MicroCeph configuration on this system.
	CephConfig map[string]string

	// existingLocalPool is the current storage pool named "local" on this system.
	existingLocalPool *api.StoragePool

	// existingRemotePool is the current storage pool named "remote" on this system.
	existingRemotePool *api.StoragePool

	// existingRemoteFSPool is the current storage pool named "remote-fs" on this system.
	existingRemoteFSPool *api.StoragePool

	// existingFanNetwork is the current network named "lxdfan0" on this system.
	existingFanNetwork *api.Network

	// existingOVNNetwork is the current network named "default" on this system.
	existingOVNNetwork *api.Network

	// existingUplinkNetwork is the current network named "UPLINK" on this system.
	existingUplinkNetwork *api.Network
}

// CollectSystemInformation fetches the current cluster information of the system specified by the connection info.
func (sh *Handler) CollectSystemInformation(ctx context.Context, connectInfo multicast.ServerInfo) (*SystemInformation, error) {
	if connectInfo.Name == "" || connectInfo.Address == "" {
		return nil, errors.New("Connection information is incomplete")
	}

	localSystem := sh.Name == connectInfo.Name

	s := &SystemInformation{
		ExistingServices:             map[types.ServiceType]map[string]string{},
		ClusterName:                  connectInfo.Name,
		ClusterAddress:               connectInfo.Address,
		AvailableDisks:               map[string]api.ResourcesStorageDisk{},
		AvailableUplinkInterfaces:    map[string]api.Network{},
		AvailableCephInterfaces:      map[string]DedicatedInterface{},
		AvailableOVNInterfaces:       map[string]DedicatedInterface{},
		AvailableFirecloudInterfaces: map[string]DedicatedInterface{},
	}

	var err error
	s.ExistingServices, err = sh.GetExistingClusters(ctx, connectInfo)
	if err != nil {
		return nil, fmt.Errorf("Failed to check for existing clusters on %q: %w", s.ClusterName, err)
	}

	var allResources *api.Resources
	lxd := sh.Services[types.LXD].(*LXDService)
	if localSystem {
		allResources, err = lxd.GetResources(ctx, s.ClusterName, "", nil)
	} else {
		allResources, err = lxd.GetResources(ctx, s.ClusterName, s.ClusterAddress, connectInfo.Certificate)
	}

	if err != nil {
		return nil, fmt.Errorf("Failed to get system resources of peer %q: %w", s.ClusterName, err)
	}

	var microceph *CephService

	// Fetch disks which are already used for remote storage.
	var usedCephDisks cephTypes.Disks
	if len(s.ExistingServices[types.MicroCeph]) > 0 {
		microceph = sh.Services[types.MicroCeph].(*CephService)

		if localSystem {
			usedCephDisks, err = microceph.GetDisks(ctx, "", nil)
		} else {
			usedCephDisks, err = microceph.GetDisks(ctx, s.ClusterAddress, connectInfo.Certificate)
		}

		if err != nil && !lxdAPI.StatusErrorCheck(err, http.StatusServiceUnavailable) {
			return nil, fmt.Errorf("Failed to get Ceph disks on %q: %w", s.ClusterName, err)
		}
	}

	if allResources != nil {
		for _, disk := range allResources.Storage.Disks {
			// Exclude non-pristine disks with partitions.
			// Disks already used for local storage (zfs) contain a partition and are therefore excluded by this check.
			if len(disk.Partitions) != 0 {
				continue
			}

			// Exclude cdrom drives as viable storage disk.
			if disk.Type == "cdrom" {
				continue
			}

			// Exclude disks which are already used for remote storage.
			diskUsed := false
			for _, usedCephDisk := range usedCephDisks {
				if usedCephDisk.Path == FormatDiskPath(disk) && usedCephDisk.Location == connectInfo.Name {
					diskUsed = true
				}
			}

			if diskUsed {
				continue
			}

			s.AvailableDisks[disk.ID] = disk
		}
	}

	// Free partitions are offered next to whole disks, so storage does not
	// need a dedicated disk. Only the machine itself can tell which are free.
	if allResources != nil {
		partitions, err := sh.freePartitions(ctx, localSystem, connectInfo)
		if err != nil {
			logger.Warn("Failed to list free partitions", logger.Ctx{"system": s.ClusterName, "error": err})
		}

		for _, disk := range PartitionDisks(allResources.Storage.Disks, partitions) {
			diskUsed := false
			for _, usedCephDisk := range usedCephDisks {
				if usedCephDisk.Path == FormatDiskPath(disk) && usedCephDisk.Location == connectInfo.Name {
					diskUsed = true
				}
			}

			if !diskUsed {
				s.AvailableDisks[disk.ID] = disk
			}
		}
	}

	var allNets []api.Network
	uplinkInterfaces, dedicatedInterfaces, allNets, err := lxd.GetNetworkInterfaces(ctx, s.ClusterName, s.ClusterAddress, connectInfo.Certificate)
	if err != nil {
		return nil, fmt.Errorf("Failed to get network interfaces on %q: %w", s.ClusterName, err)
	}

	s.AvailableUplinkInterfaces = uplinkInterfaces
	s.AvailableCephInterfaces = dedicatedInterfaces
	s.AvailableOVNInterfaces = dedicatedInterfaces
	s.AvailableFirecloudInterfaces = dedicatedInterfaces

	for _, network := range allNets {
		if network.Name == DefaultFANNetwork {
			s.existingFanNetwork = &network
			continue
		}

		if network.Name == DefaultOVNNetwork {
			s.existingOVNNetwork = &network
			continue
		}

		if network.Name == DefaultUplinkNetwork {
			s.existingUplinkNetwork = &network
			continue
		}
	}

	pools, err := lxd.GetStoragePools(ctx, s.ClusterName, s.ClusterAddress, connectInfo.Certificate)
	if err != nil {
		return nil, fmt.Errorf("Failed to get storage pools on %q: %w", s.ClusterName, err)
	}

	pool, ok := pools[DefaultZFSPool]
	if ok {
		poolCopy := pool
		s.existingLocalPool = &poolCopy
	}

	pool, ok = pools[DefaultCephPool]
	if ok {
		poolCopy := pool
		s.existingRemotePool = &poolCopy
	}

	pool, ok = pools[DefaultCephFSPool]
	if ok {
		poolCopy := pool
		s.existingRemoteFSPool = &poolCopy
	}

	if len(s.ExistingServices[types.MicroCeph]) > 0 {
		if localSystem {
			s.CephConfig, err = microceph.ClusterConfig(ctx, "", nil)
		} else {
			s.CephConfig, err = microceph.ClusterConfig(ctx, s.ClusterAddress, connectInfo.Certificate)
		}

		if err != nil && !lxdAPI.StatusErrorCheck(err, http.StatusServiceUnavailable) {
			return nil, fmt.Errorf("Failed to get Ceph configuration on %q: %w", s.ClusterName, err)
		}
	}

	if localSystem {
		s.LXDLocalConfig, s.LXDConfig, err = lxd.GetConfig(ctx, s.ServiceClustered(types.LXD), s.ClusterName, "", nil)
	} else {
		s.LXDLocalConfig, s.LXDConfig, err = lxd.GetConfig(ctx, s.ServiceClustered(types.LXD), s.ClusterName, s.ClusterAddress, connectInfo.Certificate)
	}

	if err != nil {
		return nil, fmt.Errorf("Failed to get LXD configuration on %q: %w", s.ClusterName, err)
	}

	return s, nil
}

// GetExistingClusters checks against the services reachable by the specified ServerInfo,
// and returns a map of cluster members for each service supported by the Handler.
// If a service is not clustered, its map will be nil.
func (sh *Handler) GetExistingClusters(ctx context.Context, connectInfo multicast.ServerInfo) (map[types.ServiceType]map[string]string, error) {
	localSystem := sh.Name == connectInfo.Name
	var err error
	existingServices := map[types.ServiceType]map[string]string{}
	for service := range sh.Services {
		var existingCluster map[string]string
		if localSystem {
			existingCluster, err = sh.Services[service].ClusterMembers(ctx)
		} else {
			existingCluster, err = sh.Services[service].RemoteClusterMembers(ctx, connectInfo.Certificate, connectInfo.Address)
		}

		if err != nil && !lxdAPI.StatusErrorCheck(err, http.StatusServiceUnavailable) {
			return nil, fmt.Errorf("Failed to reach %s on system %q: %w", service, connectInfo.Name, err)
		}

		// If a service isn't clustered, this loop will be skipped.

		for k, v := range existingCluster {
			if existingServices[service] == nil {
				existingServices[service] = map[string]string{}
			}

			host, _, err := net.SplitHostPort(v)
			if err != nil {
				return nil, err
			}

			existingServices[service][k] = host
		}
	}

	return existingServices, nil
}

// SupportsLocalPool checks if the SystemInformation supports a Firecloud configured local storage pool.
// Additionally returns whether such a pool already exists.
func (s *SystemInformation) SupportsLocalPool() (hasPool bool, supportsPool bool) {
	if s.existingLocalPool == nil {
		return false, true
	}

	if s.existingLocalPool.Driver == "zfs" && s.existingLocalPool.Status == "Created" {
		return true, true
	}

	return true, false
}

// SupportsRemotePool checks if the SystemInformation supports a Firecloud configured remote storage pool.
// Additionally returns whether such a pool already exists.
func (s *SystemInformation) SupportsRemotePool() (hasPool bool, supportsPool bool) {
	if s.existingRemotePool == nil {
		return false, true
	}

	if s.existingRemotePool.Driver == "ceph" && s.existingRemotePool.Status == "Created" {
		return true, true
	}

	return true, false
}

// SupportsRemoteFSPool checks if the SystemInformation supports a Firecloud configured remote-fs storage pool.
// Additionally returns whether such a pool already exists.
func (s *SystemInformation) SupportsRemoteFSPool() (hasPool bool, supportsPool bool) {
	if s.existingRemoteFSPool == nil {
		return false, true
	}

	if s.existingRemoteFSPool.Driver == "cephfs" && s.existingRemoteFSPool.Status == "Created" {
		return true, true
	}

	return true, false
}

// SupportsOVNNetwork checks if the SystemInformation supports Firecloud configured default and UPLINK networks.
// Additionally returns whether such networks already exist.
func (s *SystemInformation) SupportsOVNNetwork() (hasNet bool, supportsNet bool) {
	// If both the default OVN network and the uplink network aren't present, we can be sure that OVN wasn't yet configured.
	if s.existingOVNNetwork == nil && s.existingUplinkNetwork == nil {
		return false, true
	}

	// If either the default OVN network or the uplink network is missing, this looks to be an incomplete configuration.
	// In this case we neither have a functioning OVN network nor do we support it as we cannot anymore configure it from scratch.
	if s.existingOVNNetwork == nil || s.existingUplinkNetwork == nil {
		return false, false
	}

	// If both the default OVN network and the uplink network are matching our requirments, we indicate this to the caller.
	if s.existingOVNNetwork.Type == "ovn" && s.existingOVNNetwork.Status == "Created" && s.existingUplinkNetwork.Type == "physical" && s.existingUplinkNetwork.Status == "Created" {
		return true, true
	}

	return true, false
}

// SupportsFANNetwork checks if the SystemInformation supports a Firecloud configured lxdfan0 network.
// Additionally returns whether such a network already exists.
// If checkUsable is set, it will also check /proc/net/route to see if an interface that can support the FAN network is present.
func (s *SystemInformation) SupportsFANNetwork(checkUsable bool) (hasNet bool, supportsNet bool, err error) {
	if s.existingFanNetwork == nil {
		if checkUsable {
			available, _, err := FanNetworkUsable()
			if err != nil {
				return false, false, err
			}

			return false, available, nil
		}

		return false, true, nil
	}

	if s.existingFanNetwork.Type == "bridge" && s.existingFanNetwork.Status == "Created" {
		return true, true, nil
	}

	return true, false, nil
}

// ServiceClustered returns whether or not a particular service is already clustered
// by checking if there are any cluster members in-memory.
func (s *SystemInformation) ServiceClustered(service types.ServiceType) bool {
	return len(s.ExistingServices[service]) > 0
}

// ClustersConflict compares the cluster members reported by each system in the list of systems, for each given service.
// If two distinct clusters exist for any service, this function returns true, with the name of the service.
func ClustersConflict(systems map[string]SystemInformation, services map[types.ServiceType]string) (bool, types.ServiceType) {
	firstEncounteredClusters := map[types.ServiceType]map[string]string{}
	for _, info := range systems {
		for service := range services {
			// If a service is not clustered, it cannot conflict.
			if !info.ServiceClustered(service) {
				continue
			}

			// Record the first encountered cluster for each service.
			cluster, encountered := firstEncounteredClusters[service]
			if !encountered {
				firstEncounteredClusters[service] = info.ExistingServices[service]

				continue
			}

			// Check if the first encountered cluster for this service is identical to each system's record.
			for name, addr := range info.ExistingServices[service] {
				if cluster[name] != addr {
					return true, service
				}
			}

			if len(cluster) != len(info.ExistingServices[service]) {
				return true, service
			}
		}
	}

	return false, ""
}

// FormatDiskPath returns a disk's path representation.
func FormatDiskPath(disk api.ResourcesStorageDisk) string {
	devicePath := "/dev/" + disk.ID
	if disk.DeviceID != "" {
		devicePath = "/dev/disk/by-id/" + disk.DeviceID
	} else if disk.DevicePath != "" {
		devicePath = "/dev/disk/by-path/" + disk.DevicePath
	}

	return devicePath
}

// freePartitions asks the Firecloud daemon of the system which partitions are free.
func (sh *Handler) freePartitions(ctx context.Context, localSystem bool, connectInfo multicast.ServerInfo) ([]string, error) {
	cloud, ok := sh.Services[types.Firecloud].(*CloudService)
	if !ok {
		return nil, nil
	}

	var c microTypes.Client
	var err error
	if localSystem {
		c, err = cloud.Client()
	} else {
		c, err = cloud.RemoteClient(connectInfo.Certificate, connectInfo.Address)
	}

	if err != nil {
		return nil, err
	}

	return cloudClient.GetFreePartitions(ctx, c)
}

// PartitionDisks turns the named partitions of disks into disk entries the
// disk selection can offer, with by-id or by-path links of the partition
// (udev names them <disk link>-part<N>).
func PartitionDisks(disks []api.ResourcesStorageDisk, names []string) []api.ResourcesStorageDisk {
	out := []api.ResourcesStorageDisk{}
	for _, disk := range disks {
		for _, p := range disk.Partitions {
			if !slices.Contains(names, p.ID) || p.ReadOnly {
				continue
			}

			suffix := fmt.Sprintf("-part%d", p.Partition)
			entry := api.ResourcesStorageDisk{
				ID:    p.ID,
				Model: fmt.Sprintf("%s (partition %d)", disk.Model, p.Partition),
				Type:  "partition",
				Size:  p.Size,
			}

			if disk.DeviceID != "" {
				entry.DeviceID = disk.DeviceID + suffix
			} else if disk.DevicePath != "" {
				entry.DevicePath = disk.DevicePath + suffix
			}

			out = append(out, entry)
		}
	}

	return out
}
