package main

import (
	"testing"

	"github.com/lxc/incus/v7/shared/api"
	"github.com/stretchr/testify/require"

	"github.com/m41denx/incendio/firecloud/service"
)

func TestSharedDisks(t *testing.T) {
	lun := api.ResourcesStorageDisk{ID: "sdb", DeviceID: "wwn-0x6001405abc", Model: "LIO-ORG", Size: 100 << 30}
	states := map[string]service.SystemInformation{
		"a": {AvailableDisks: map[string]api.ResourcesStorageDisk{
			"sdb": lun,
			"sdc": {ID: "sdc", DeviceID: "ata-local-a"},
		}},
		"b": {AvailableDisks: map[string]api.ResourcesStorageDisk{
			"sdd": {ID: "sdd", DeviceID: "wwn-0x6001405abc"},
			"sde": {ID: "sde", DeviceID: "ata-local-b"},
			"loop,8G,1": {ID: "loop,8G,1", Type: diskTypeLoop},
		}},
	}

	shared := sharedDisks(states)
	require.Len(t, shared, 1)
	require.Equal(t, "/dev/disk/by-id/wwn-0x6001405abc", service.FormatDiskPath(shared[0]))

	delete(states["b"].AvailableDisks, "sdd")
	require.Empty(t, sharedDisks(states))
}
