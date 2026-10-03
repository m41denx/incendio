package service

import (
	"testing"

	"github.com/lxc/incus/v7/shared/api"
	"github.com/stretchr/testify/require"
)

func TestParseFreePartitions(t *testing.T) {
	// A server disk with the OS, a spare partition, a small one, a BIOS boot
	// partition and an LVM physical volume, plus a disk with no partitions.
	lsblk := []byte(`{"blockdevices": [
	  {"name": "sda", "type": "disk", "fstype": null, "parttype": null, "mountpoints": [null], "size": 500107862016, "children": [
	    {"name": "sda1", "type": "part", "fstype": null, "parttype": "21686148-6449-6e6f-744e-656564454649", "mountpoints": [null], "size": 1048576},
	    {"name": "sda2", "type": "part", "fstype": "ext4", "parttype": "0fc63daf-8483-4772-8e79-3d69d8477de4", "mountpoints": ["/"], "size": 107374182400},
	    {"name": "sda3", "type": "part", "fstype": null, "parttype": "0fc63daf-8483-4772-8e79-3d69d8477de4", "mountpoints": [null], "size": 214748364800},
	    {"name": "sda4", "type": "part", "fstype": null, "parttype": "0fc63daf-8483-4772-8e79-3d69d8477de4", "mountpoints": [null], "size": 524288000},
	    {"name": "sda5", "type": "part", "fstype": "LVM2_member", "parttype": "e6d6d379-f507-44c2-a23c-238f2a3df928", "mountpoints": [null], "size": 107374182400, "children": [
	      {"name": "vg-lv", "type": "lvm", "fstype": "ext4", "mountpoints": ["/srv"], "size": 107374182400}
	    ]}
	  ]},
	  {"name": "sdb", "type": "disk", "fstype": null, "parttype": null, "mountpoints": [null], "size": 1000204886016}
	]}`)

	free, err := ParseFreePartitions(lsblk)
	require.NoError(t, err)
	require.Equal(t, []string{"sda3"}, free)

	_, err = ParseFreePartitions([]byte("nope"))
	require.Error(t, err)
}

func TestPartitionDisks(t *testing.T) {
	disks := []api.ResourcesStorageDisk{
		{ID: "sda", Model: "Samsung SSD", DeviceID: "ata-Samsung_SSD_123", Partitions: []api.ResourcesStorageDiskPartition{
			{ID: "sda2", Partition: 2, Size: 100 << 30},
			{ID: "sda3", Partition: 3, Size: 200 << 30},
		}},
		{ID: "vda", Model: "", DevicePath: "pci-0000:00:05.0", Partitions: []api.ResourcesStorageDiskPartition{
			{ID: "vda1", Partition: 1, Size: 10 << 30},
		}},
	}

	got := PartitionDisks(disks, []string{"sda3", "vda1"})
	require.Len(t, got, 2)
	require.Equal(t, "/dev/disk/by-id/ata-Samsung_SSD_123-part3", FormatDiskPath(got[0]))
	require.Equal(t, "partition", got[0].Type)
	require.Equal(t, uint64(200<<30), got[0].Size)
	require.Equal(t, "/dev/disk/by-path/pci-0000:00:05.0-part1", FormatDiskPath(got[1]))
}
