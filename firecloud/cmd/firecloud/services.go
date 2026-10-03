package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"sync"

	incus "github.com/lxc/incus/v7/client"
	lxdAPI "github.com/canonical/lxd/shared/api"
	"github.com/canonical/microcluster/v3/microcluster"
	cli "github.com/lxc/incus/v7/shared/cmd"
	"github.com/spf13/cobra"

	"github.com/m41denx/incendio/firecloud/api"
	"github.com/m41denx/incendio/firecloud/api/types"
	"github.com/m41denx/incendio/firecloud/cmd/tui"
	"github.com/m41denx/incendio/firecloud/multicast"
	"github.com/m41denx/incendio/firecloud/service"
)

type cmdServices struct {
	common *CmdControl
}

// command returns the subcommand to manage Firecloud services.
func (c *cmdServices) command() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "service",
		Short: "Manage Firecloud services",
		RunE:  func(cmd *cobra.Command, args []string) error { return cmd.Help() },
	}

	var cmdServiceList = cmdServiceList{common: c.common}
	cmd.AddCommand(cmdServiceList.command())

	var cmdServiceAdd = cmdServiceAdd{common: c.common}
	cmd.AddCommand(cmdServiceAdd.command())

	return cmd
}

type cmdServiceList struct {
	common *CmdControl
}

// command returns the subcommand to list Firecloud services.
func (c *cmdServiceList) command() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "list",
		Short: "List Firecloud services and their cluster members",
		RunE:  c.run,
	}

	return cmd
}

// run runs the subcommand to list Firecloud services.
func (c *cmdServiceList) run(cmd *cobra.Command, args []string) error {
	if len(args) != 0 {
		return cmd.Help()
	}

	// Get a microcluster client so we can get state information.
	cloudApp, err := microcluster.App(microcluster.Args{StateDir: c.common.FlagFirecloudDir})
	if err != nil {
		return err
	}

	err = cloudApp.Ready(context.Background())
	if err != nil {
		return fmt.Errorf("Failed to wait for Firecloud to get ready: %w", err)
	}

	// Fetch the name and address, and ensure we're initialized.
	status, err := cloudApp.Status(context.Background())
	if err != nil {
		return fmt.Errorf("Failed to get Firecloud status: %w", err)
	}

	if !status.Ready {
		return errors.New("Firecloud is uninitialized, run 'firecloud init' first")
	}

	services := []types.ServiceType{types.Firecloud, types.LXD}
	optionalServices := map[types.ServiceType]string{
		types.MicroCeph: api.MicroCephDir,
		types.MicroOVN:  api.MicroOVNDir,
	}

	cfg := initConfig{
		autoSetup: true,
		bootstrap: false,
		common:    c.common,
		asker:     c.common.asker,
		systems:   map[string]InitSystem{},
		state:     map[string]service.SystemInformation{},
	}

	cfg.name = status.Name
	cfg.address = status.Address.Addr().String()

	services, err = cfg.askMissingServices(services, optionalServices)
	if err != nil {
		return err
	}

	// Instantiate a handler for the services.
	s, err := service.NewHandler(status.Name, status.Address.Addr().String(), c.common.FlagFirecloudDir, services...)
	if err != nil {
		return err
	}

	mu := sync.Mutex{}
	header := []string{"NAME", "ADDRESS", "ROLE", "STATUS"}
	allClusters := map[types.ServiceType][][]string{}
	err = s.RunConcurrent("", "", func(s service.Service) error {
		var err error
		var data [][]string
		var m *microcluster.MicroCluster
		var lxd incus.InstanceServer
		switch s.Type() {
		case types.LXD:
			lxd, err = s.(*service.LXDService).Client(context.Background())
			if err != nil {
				return err
			}

		case types.MicroCeph:
			m = s.(*service.CephService).Microcluster()
		case types.MicroOVN:
			m = s.(*service.OVNService).Microcluster()
		case types.Firecloud:
			m = s.(*service.CloudService).Microcluster()
		}

		if m != nil {
			clusterMembers, err := m.GetClusterMembers(context.Background())
			if err != nil && !lxdAPI.StatusErrorCheck(err, http.StatusServiceUnavailable) {
				return err
			}

			if len(clusterMembers) != 0 {
				data = make([][]string, len(clusterMembers))
				for i, clusterMember := range clusterMembers {
					data[i] = []string{clusterMember.Name, clusterMember.Address.String(), clusterMember.Role, string(clusterMember.Status)}
				}

				sort.Sort(cli.SortColumnsNaturally(data))
			}
		} else if lxd != nil {
			server, _, err := lxd.GetServer()
			if err != nil {
				return err
			}

			if server.Environment.ServerClustered {
				clusterMembers, err := lxd.GetClusterMembers()
				if err != nil {
					return err
				}

				data = make([][]string, len(clusterMembers))
				for i, clusterMember := range clusterMembers {
					data[i] = []string{clusterMember.ServerName, clusterMember.URL, strings.Join(clusterMember.Roles, "\n"), string(clusterMember.Status)}
				}

				sort.Sort(cli.SortColumnsNaturally(data))
			}
		}

		mu.Lock()
		allClusters[s.Type()] = data
		mu.Unlock()

		return nil
	})
	if err != nil {
		return err
	}

	for serviceType, data := range allClusters {
		if len(data) == 0 {
			fmt.Printf("%s: Not initialized\n", serviceType)
		} else {
			fmt.Printf("%s:\n", serviceType)
			fmt.Println(tui.NewTable(header, data))
		}
	}

	return nil
}

type cmdServiceAdd struct {
	common *CmdControl
}

// command returns the subcommand to add services to Firecloud.
func (c *cmdServiceAdd) command() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "add",
		Short: "Add new services to the existing Firecloud",
		RunE:  c.run,
	}

	return cmd
}

// run runs the subcommand to add services to Firecloud.
func (c *cmdServiceAdd) run(cmd *cobra.Command, args []string) error {
	if len(args) != 0 {
		return cmd.Help()
	}

	fmt.Println("Waiting for services to start ...")
	err := checkInitialized(c.common.FlagFirecloudDir, true, false)
	if err != nil {
		return err
	}

	cfg := initConfig{
		// Set bootstrap to true because we are setting up a new cluster for new services.
		bootstrap: true,
		setupMany: true,
		common:    c.common,
		asker:     c.common.asker,
		systems:   map[string]InitSystem{},
		state:     map[string]service.SystemInformation{},
	}

	// Get a microcluster client so we can get state information.
	cloudApp, err := microcluster.App(microcluster.Args{StateDir: c.common.FlagFirecloudDir})
	if err != nil {
		return err
	}

	// Fetch the name and address, and ensure we're initialized.
	status, err := cloudApp.Status(context.Background())
	if err != nil {
		return fmt.Errorf("Failed to get Firecloud status: %w", err)
	}

	cfg.name = status.Name
	cfg.address = status.Address.Addr().String()
	// enable auto setup to skip lookup related questions.
	cfg.autoSetup = true
	err = cfg.askAddress("")
	if err != nil {
		return err
	}

	cfg.autoSetup = false
	installedServices := []types.ServiceType{types.Firecloud, types.LXD}
	optionalServices := map[types.ServiceType]string{
		types.MicroCeph: api.MicroCephDir,
		types.MicroOVN:  api.MicroOVNDir,
	}

	// Set the auto flag to true so that we automatically omit any services that aren't installed.
	installedServices, err = cfg.askMissingServices(installedServices, optionalServices)
	if err != nil {
		return err
	}

	// Instantiate a handler for the services.
	s, err := service.NewHandler(cfg.name, cfg.address, c.common.FlagFirecloudDir, installedServices...)
	if err != nil {
		return err
	}

	services := make(map[types.ServiceType]string, len(installedServices))
	for _, s := range s.Services {
		version, err := s.GetVersion(context.Background())
		if err != nil {
			return err
		}

		services[s.Type()] = version
	}

	state, err := s.CollectSystemInformation(context.Background(), multicast.ServerInfo{Name: cfg.name, Address: cfg.address, Services: services})
	if err != nil {
		return err
	}

	cfg.state[cfg.name] = *state
	// Create an InitSystem map to carry through the interactive setup.
	clusters := cfg.state[cfg.name].ExistingServices
	for name, address := range clusters[types.Firecloud] {
		cfg.systems[name] = InitSystem{
			ServerInfo: multicast.ServerInfo{
				Name:     name,
				Address:  address,
				Services: services,
			},
		}
	}

	for _, system := range cfg.systems {
		if system.ServerInfo.Name == "" || system.ServerInfo.Name == cfg.name {
			continue
		}

		state, err := s.CollectSystemInformation(context.Background(), system.ServerInfo)
		if err != nil {
			return err
		}

		cfg.state[system.ServerInfo.Name] = *state
	}

	askClusteredServices := map[types.ServiceType]string{}
	serviceMap := map[types.ServiceType]bool{}
	for _, state := range cfg.state {
		localState := cfg.state[s.Name]
		if len(state.ExistingServices[types.LXD]) != len(localState.ExistingServices[types.LXD]) || len(state.ExistingServices[types.LXD]) <= 0 {
			return errors.New("Unable to add services. Some systems are not part of the LXD cluster")
		}

		if len(state.ExistingServices[types.MicroCeph]) <= 0 && !serviceMap[types.MicroCeph] {
			askClusteredServices[types.MicroCeph] = services[types.MicroCeph]
			serviceMap[types.MicroCeph] = true
		}

		if len(state.ExistingServices[types.MicroOVN]) <= 0 && !serviceMap[types.MicroOVN] {
			askClusteredServices[types.MicroOVN] = services[types.MicroOVN]
			serviceMap[types.MicroOVN] = true
		}
	}

	if len(askClusteredServices) == 0 {
		return errors.New("All services have already been set up")
	}

	err = cfg.askClustered(s, askClusteredServices)
	if err != nil {
		return err
	}

	// Go through the normal setup for disks and networks if necessary.
	if askClusteredServices[types.MicroCeph] != "" {
		err := cfg.askDisks(s)
		if err != nil {
			return err
		}
	}

	if askClusteredServices[types.MicroOVN] != "" {
		err := cfg.askNetwork(s)
		if err != nil {
			return err
		}
	}

	err = cfg.setupCluster(s)
	if err != nil {
		return err
	}

	fmt.Println(tui.SuccessColor("Firecloud is ready", true))
	return nil
}
