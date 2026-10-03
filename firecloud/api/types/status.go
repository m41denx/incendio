package types

import (
	"time"

	cephTypes "github.com/canonical/microceph/microceph/api/types"
	microTypes "github.com/canonical/microcluster/v3/microcluster/types"
	ovnTypes "github.com/canonical/microovn/microovn/api/types"
)

// Status is a set of status information from a cluster member.
type Status struct {
	// Name represents the cluster name for the member.
	Name string `json:"name" yaml:"name"`

	// Address represnts the cluster address for the member.
	Address string `json:"address" yaml:"address"`

	// Clusters is a list of cluster members for each service installed on the member.
	Clusters map[ServiceType][]microTypes.ClusterMember `json:"clusters" yaml:"clusters"`

	// OSDs is a list of all OSDs local to the member.
	OSDs cephTypes.Disks `json:"osds" yaml:"osds"`

	// CephServices is a list of all ceph services running on this member.
	CephServices cephTypes.Services `json:"ceph_services" yaml:"ceph_services"`

	// OVNServices is a list of all ovn services running on this member.
	OVNServices ovnTypes.Services `json:"ovn_services" yaml:"ovn_services"`

	// Sync is the outcome of the member's last sync of OVN, Ceph and LVM settings into Incus.
	Sync SyncStatus `json:"sync" yaml:"sync"`
}

// SyncStatus is the outcome of a member's last sync.
type SyncStatus struct {
	// LastRun is when the last sync ran; zero if it has not run yet.
	LastRun time.Time `json:"last_run" yaml:"last_run"`

	// LastSuccess is when a sync last ran without errors.
	LastSuccess time.Time `json:"last_success" yaml:"last_success"`

	// Applied lists what the last sync changed.
	Applied []string `json:"applied" yaml:"applied"`

	// Errors lists what failed in the last sync.
	Errors []string `json:"errors" yaml:"errors"`
}
