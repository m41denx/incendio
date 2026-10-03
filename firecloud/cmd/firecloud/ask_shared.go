package main

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"sort"
	"strings"

	"github.com/canonical/lxd/shared/units"
	"github.com/lxc/incus/v7/shared/api"

	"github.com/m41denx/incendio/firecloud/api/types"
	"github.com/m41denx/incendio/firecloud/cmd/tui"
	"github.com/m41denx/incendio/firecloud/service"
)

// Shared storage without Ceph: a TrueNAS server (iSCSI) or one disk every
// member sees, locked with clustered LVM. Either becomes the "remote" pool.
const (
	sharedTrueNAS    = "truenas"
	sharedLVMCluster = "lvmcluster"
)

// askSharedPool offers TrueNAS or clustered LVM as the shared pool when Ceph
// does not provide one. Only drivers Incus supports on every system are
// offered (see "firecloud install --truenas/--lvmcluster").
func (c *initConfig) askSharedPool(sh *service.Handler) error {
	if c.hasRemotePool() {
		return nil
	}

	existing := c.existingSharedPool()
	if existing != nil {
		return c.joinSharedPool(sh, existing)
	}

	options := []string{}
	for _, driver := range []string{sharedTrueNAS, sharedLVMCluster} {
		supported := len(c.state) > 0
		for _, state := range c.state {
			if !slices.Contains(state.StorageDrivers, driver) {
				supported = false
			}
		}

		if supported {
			options = append(options, driver)
		}
	}

	if len(options) == 0 {
		return nil
	}

	answers := append(slices.Clone(options), "no")
	choice, err := c.asker.AskString(fmt.Sprintf("Would you like shared storage on %s? [%s]", strings.Join(options, " or "), strings.Join(answers, "/")), "no", func(input string) error {
		if !slices.Contains(answers, input) {
			return fmt.Errorf("Answer one of: %s", strings.Join(answers, ", "))
		}

		return nil
	})
	if err != nil {
		return err
	}

	switch choice {
	case sharedTrueNAS:
		return c.askTrueNASPool(sh)
	case sharedLVMCluster:
		return c.askLVMClusterPool(sh)
	}

	return nil
}

// hasRemotePool reports whether a "remote" pool is already planned (Ceph).
func (c *initConfig) hasRemotePool() bool {
	for _, system := range c.systems {
		for _, pool := range append(slices.Clone(system.TargetStoragePools), system.StoragePools...) {
			if pool.Name == service.DefaultCephPool {
				return true
			}
		}

		for _, cfg := range system.JoinConfig {
			if cfg.Entity == "storage-pool" && cfg.Name == service.DefaultCephPool {
				return true
			}
		}
	}

	return false
}

// existingSharedPool returns the cluster's TrueNAS or clustered LVM pool, if any.
func (c *initConfig) existingSharedPool() *api.StoragePool {
	for _, state := range c.state {
		pool := state.ExistingRemotePool()
		if pool != nil && (pool.Driver == sharedTrueNAS || pool.Driver == sharedLVMCluster) {
			return pool
		}
	}

	return nil
}

// joinSharedPool gives new members the existing pool's per-member settings.
func (c *initConfig) joinSharedPool(sh *service.Handler, pool *api.StoragePool) error {
	lxd := sh.Services[types.LXD].(*service.LXDService)
	client, err := lxd.Client(context.Background())
	if err != nil {
		return err
	}

	// Per-member keys only show when asking a member that has the pool.
	var memberConfig map[string]string
	for name, state := range c.state {
		if state.ExistingRemotePool() == nil {
			continue
		}

		existing, _, err := client.UseTarget(name).GetStoragePool(pool.Name)
		if err == nil {
			memberConfig = existing.Config
			break
		}
	}

	if memberConfig == nil {
		return fmt.Errorf("Failed to read the settings of the %q pool from an existing member", pool.Name)
	}

	joinConfig := lxd.SharedPoolJoinConfig(memberConfig)
	for name, state := range c.state {
		if state.ExistingRemotePool() != nil {
			continue
		}

		system := c.systems[name]
		system.JoinConfig = append(system.JoinConfig, joinConfig...)
		c.systems[name] = system
	}

	if pool.Driver == sharedLVMCluster {
		c.lvmCluster = true
	}

	return nil
}

func (c *initConfig) askTrueNASPool(sh *service.Handler) error {
	lxd := sh.Services[types.LXD].(*service.LXDService)
	notEmpty := func(input string) error {
		if strings.TrimSpace(input) == "" {
			return errors.New("A value is required")
		}

		return nil
	}

	host, err := c.asker.AskString("TrueNAS host (name or address):", "", notEmpty)
	if err != nil {
		return err
	}

	apiKey, err := c.asker.AskString("TrueNAS API key:", "", notEmpty)
	if err != nil {
		return err
	}

	dataset, err := c.asker.AskString("Dataset for Incus volumes (e.g. tank/incus/):", "", notEmpty)
	if err != nil {
		return err
	}

	insecure, err := c.asker.AskBool("Accept a self-signed TrueNAS certificate?", false)
	if err != nil {
		return err
	}

	cfg := service.TrueNASConfig{Host: host, APIKey: apiKey, Dataset: dataset, AllowInsecure: insecure}
	for name, system := range c.systems {
		system.TargetStoragePools = append(system.TargetStoragePools, lxd.DefaultPendingTrueNASStoragePool(cfg))
		if name == sh.Name {
			system.StoragePools = append(system.StoragePools, lxd.DefaultTrueNASStoragePool(cfg))
		}

		c.systems[name] = system
	}

	fmt.Println(tui.SummarizeResult("Using dataset %s on TrueNAS %s for the shared storage pool", dataset, host))

	return nil
}

func (c *initConfig) askLVMClusterPool(sh *service.Handler) error {
	lxd := sh.Services[types.LXD].(*service.LXDService)
	shared := c.sharedLUNs
	if len(c.state) == 1 {
		shared = sharedDisks(c.state)
	}

	if len(shared) == 0 {
		tui.PrintWarning("No disk is visible on every system with the same ID. Connect the shared LUN (iSCSI, FC, NVMe-oF) on every system first. Skipping shared storage")

		return nil
	}

	header := []string{"MODEL", "CAPACITY", "PATH"}
	data := [][]string{}
	for _, disk := range shared {
		data = append(data, []string{disk.Model, units.GetByteSizeStringIEC(int64(disk.Size), 2), service.FormatDiskPath(disk)})
	}

	var path string
	err := c.askRetry("Retry selecting the shared disk?", func() error {
		table := tui.NewSelectableTable(header, data)
		answers, err := table.Render(context.Background(), c.asker, "Select the shared disk for clustered LVM (it will be wiped):")
		if err != nil {
			return err
		}

		if len(answers) != 1 {
			return errors.New("Select exactly one disk")
		}

		path = answers[0]["PATH"]

		return nil
	})
	if err != nil {
		return err
	}

	tui.PrintWarning("Clustered LVM has no thin provisioning, and no snapshots of shared or raw block volumes")

	for name, system := range c.systems {
		system.TargetStoragePools = append(system.TargetStoragePools, lxd.DefaultPendingLVMClusterStoragePool(path, service.DefaultLVMClusterVG))
		if name == sh.Name {
			system.StoragePools = append(system.StoragePools, lxd.DefaultLVMClusterStoragePool())
		}

		c.systems[name] = system

		// The disk now belongs to the shared pool.
		state := c.state[name]
		for id, disk := range state.AvailableDisks {
			if service.FormatDiskPath(disk) == path {
				delete(state.AvailableDisks, id)
			}
		}

		c.state[name] = state
	}

	c.lvmCluster = true
	fmt.Println(tui.SummarizeResult("Using %s for the shared storage pool (clustered LVM)", path))

	return nil
}

// sharedDisks returns the whole disks every system sees under the same
// by-id name (a shared LUN), sorted by path.
func sharedDisks(states map[string]service.SystemInformation) []api.ResourcesStorageDisk {
	seen := map[string]int{}
	byPath := map[string]api.ResourcesStorageDisk{}
	for _, state := range states {
		for _, disk := range state.AvailableDisks {
			if disk.DeviceID == "" || disk.Type == "partition" || disk.Type == diskTypeLoop {
				continue
			}

			path := service.FormatDiskPath(disk)
			seen[path]++
			byPath[path] = disk
		}
	}

	out := []api.ResourcesStorageDisk{}
	for path, count := range seen {
		if count == len(states) {
			out = append(out, byPath[path])
		}
	}

	sort.Slice(out, func(i, j int) bool { return service.FormatDiskPath(out[i]) < service.FormatDiskPath(out[j]) })

	return out
}
