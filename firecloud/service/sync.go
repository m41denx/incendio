package service

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/canonical/lxd/shared/logger"
	incus "github.com/lxc/incus/v7/client"
	"github.com/lxc/incus/v7/shared/api"

	"github.com/m41denx/incendio/firecloud/api/types"
	"github.com/m41denx/incendio/firecloud/integration"
)

// SyncInterval is how often the daemon brings Incus in step with MicroOVN,
// MicroCeph and clustered LVM.
const SyncInterval = time.Minute

// Syncer keeps the settings Incus needs from the snaps it runs with up to
// date on this member (see the integration package). It only ever adds or
// replaces values; it never clears a setting.
type Syncer struct {
	sh *Handler

	// Paths, replaced in tests.
	ovnRoot      string
	cephConf     string
	cephConfDir  string
	lvmConf      string
	lvmLocalConf string

	runMu sync.Mutex

	statusMu sync.Mutex
	status   types.SyncStatus

	trigger chan struct{}

	// Ready reports whether Firecloud is initialized; until then there is
	// nothing to sync. Nil means always ready.
	Ready func(ctx context.Context) bool
}

// NewSyncer returns a Syncer for the handler's services.
func NewSyncer(sh *Handler) *Syncer {
	return &Syncer{
		sh:           sh,
		ovnRoot:      integration.MicroOVNRoot,
		cephConf:     integration.MicroCephConf,
		cephConfDir:  integration.CephConfDir,
		lvmConf:      integration.LVMConf,
		lvmLocalConf: integration.LVMLocalConf,
		trigger:      make(chan struct{}, 1),
	}
}

// Run syncs every SyncInterval and whenever Trigger is called, until ctx ends.
func (s *Syncer) Run(ctx context.Context) {
	ticker := time.NewTicker(SyncInterval)
	defer ticker.Stop()

	for {
		s.Sync(ctx)

		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		case <-s.trigger:
		}
	}
}

// Trigger asks Run for a sync soon, without waiting for it.
func (s *Syncer) Trigger() {
	select {
	case s.trigger <- struct{}{}:
	default:
	}
}

// Status returns the outcome of the last sync.
func (s *Syncer) Status() types.SyncStatus {
	s.statusMu.Lock()
	defer s.statusMu.Unlock()

	status := s.status
	status.Errors = slices.Clone(s.status.Errors)
	status.Applied = slices.Clone(s.status.Applied)

	return status
}

// Sync runs one sync now and returns its outcome.
func (s *Syncer) Sync(ctx context.Context) types.SyncStatus {
	s.runMu.Lock()
	defer s.runMu.Unlock()

	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	if s.Ready != nil && !s.Ready(ctx) {
		return s.Status()
	}

	result := types.SyncStatus{LastRun: time.Now().UTC()}
	applied, errs := s.syncAll(ctx)
	result.Applied = applied
	for _, err := range errs {
		result.Errors = append(result.Errors, err.Error())
		logger.Warn("Sync failed", logger.Ctx{"error": err})
	}

	for _, change := range applied {
		logger.Info("Synced", logger.Ctx{"change": change})
	}

	s.statusMu.Lock()
	if len(errs) == 0 {
		result.LastSuccess = result.LastRun
	} else {
		result.LastSuccess = s.status.LastSuccess
	}

	s.status = result
	s.statusMu.Unlock()

	return result
}

// syncAll runs each part and collects what changed and what failed. Parts
// that do not apply to this member (snap not installed, Incus not clustered
// yet) are skipped silently.
func (s *Syncer) syncAll(ctx context.Context) ([]string, []error) {
	applied := []string{}
	errs := []error{}

	if s.sh.Services[types.MicroCeph] != nil {
		_, err := os.Stat(s.cephConf)
		if err == nil {
			written, err := integration.SyncCeph(s.cephConf, s.cephConfDir)
			for _, path := range written {
				applied = append(applied, "wrote "+path)
			}

			if err != nil {
				errs = append(errs, fmt.Errorf("Ceph: %w", err))
			}
		}
	}

	lxd, ok := s.sh.Services[types.LXD].(*LXDService)
	if !ok {
		return applied, errs
	}

	client, err := lxd.Client(ctx)
	if err != nil {
		return applied, append(errs, fmt.Errorf("Incus: %w", err))
	}

	server, _, err := client.GetServer()
	if err != nil {
		return applied, append(errs, fmt.Errorf("Incus: %w", err))
	}

	if !server.Environment.ServerClustered {
		return applied, errs
	}

	if s.sh.Services[types.MicroOVN] != nil {
		changes, err := s.syncOVN(client, server)
		applied = append(applied, changes...)
		if err != nil {
			errs = append(errs, fmt.Errorf("OVN: %w", err))
		}
	}

	changes, err := s.syncLVM(ctx, server)
	applied = append(applied, changes...)
	if err != nil {
		errs = append(errs, fmt.Errorf("Clustered LVM: %w", err))
	}

	return applied, errs
}

// syncOVN points Incus at MicroOVN. The cluster-wide keys are written by one
// member only (the first online one by name) so members do not take turns
// overwriting each other's client certificate; every member sets its own
// Open vSwitch socket.
func (s *Syncer) syncOVN(client incus.InstanceServer, server *api.Server) ([]string, error) {
	_, err := os.Stat(s.ovnRoot)
	if err != nil {
		return nil, nil
	}

	applied := []string{}
	name := s.sh.Name
	local, etag, err := client.UseTarget(name).GetServer()
	if err != nil {
		return nil, err
	}

	if local.Config[integration.KeyOVSConnection] != integration.OVSConnection {
		put := local.Writable()
		put.Config[integration.KeyOVSConnection] = integration.OVSConnection
		err = client.UseTarget(name).UpdateServer(put, etag)
		if err != nil {
			return applied, err
		}

		applied = append(applied, "set "+integration.KeyOVSConnection)
	}

	writer, err := firstOnlineMember(client)
	if err != nil {
		return applied, err
	}

	if writer != name {
		return applied, nil
	}

	state, err := integration.ReadOVN(s.ovnRoot)
	if err != nil {
		return applied, err
	}

	changes := integration.Changes(server.Config, state.GlobalConfig())
	if len(changes) == 0 {
		return applied, nil
	}

	put := server.Writable()
	for key, value := range changes {
		put.Config[key] = value
		applied = append(applied, "set "+key)
	}

	slices.Sort(applied)

	return applied, client.UpdateServer(put, "")
}

// syncLVM keeps this member ready for clustered LVM once it has a sanlock
// host_id (assigned when an lvmcluster pool is set up).
func (s *Syncer) syncLVM(ctx context.Context, server *api.Server) ([]string, error) {
	value := server.Config[integration.KeyLVMHostIDs]
	if value == "" {
		return nil, nil
	}

	ids, err := integration.ParseHostIDs(value)
	if err != nil {
		return nil, err
	}

	hostID, ok := ids[s.sh.Name]
	if !ok {
		return nil, fmt.Errorf("No sanlock host_id assigned to %q", s.sh.Name)
	}

	return EnsureLVMLocking(ctx, hostID, s.lvmConf, s.lvmLocalConf)
}

// EnsureLVMLocking enables lvmlockd in lvmConf, writes hostID to
// lvmLocalConf and starts lvmlockd and sanlock when they are not running.
func EnsureLVMLocking(ctx context.Context, hostID int, lvmConf string, lvmLocalConf string) ([]string, error) {
	applied := []string{}
	content, err := os.ReadFile(lvmConf)
	if err != nil {
		return nil, fmt.Errorf("Failed to read %s (is lvm2 installed?): %w", lvmConf, err)
	}

	if !integration.LockdEnabled(string(content)) {
		updated, err := integration.EnableLvmlockd(string(content))
		if err != nil {
			return nil, err
		}

		_, err = integration.WriteIfChanged(lvmConf, []byte(updated), 0o644)
		if err != nil {
			return nil, err
		}

		applied = append(applied, "enabled use_lvmlockd in "+lvmConf)
	}

	changed, err := integration.WriteIfChanged(lvmLocalConf, []byte(integration.LocalConf(hostID)), 0o644)
	if err != nil {
		return applied, err
	}

	if changed {
		applied = append(applied, fmt.Sprintf("set host_id %d in %s", hostID, lvmLocalConf))
	}

	for _, unit := range []string{"sanlock", "lvmlockd"} {
		err := exec.CommandContext(ctx, "systemctl", "is-active", "--quiet", unit).Run()
		if err == nil {
			continue
		}

		out, err := exec.CommandContext(ctx, "systemctl", "enable", "--now", unit).CombinedOutput()
		if err != nil {
			return applied, fmt.Errorf("Failed to start %s: %s", unit, strings.TrimSpace(string(out)))
		}

		applied = append(applied, "started "+unit)
	}

	return applied, nil
}

// firstOnlineMember returns the name of the first online Incus member by name.
func firstOnlineMember(client incus.InstanceServer) (string, error) {
	members, err := client.GetClusterMembers()
	if err != nil {
		return "", err
	}

	names := []string{}
	for _, m := range members {
		if strings.EqualFold(m.Status, "Online") {
			names = append(names, m.ServerName)
		}
	}

	if len(names) == 0 {
		return "", errors.New("No online Incus cluster member")
	}

	slices.Sort(names)

	return names[0], nil
}
