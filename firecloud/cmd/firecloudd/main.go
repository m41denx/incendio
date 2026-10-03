// Package firecloudd provides the daemon.
package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/canonical/lxd/lxd/util"
	lxdAPI "github.com/canonical/lxd/shared/api"
	"github.com/canonical/lxd/shared/logger"
	"github.com/canonical/microcluster/v3/microcluster"
	microTypes "github.com/canonical/microcluster/v3/microcluster/types"
	"github.com/spf13/cobra"
	"golang.org/x/sync/errgroup"

	"github.com/m41denx/incendio/firecloud/api"
	"github.com/m41denx/incendio/firecloud/api/types"
	"github.com/m41denx/incendio/firecloud/service"
	"github.com/m41denx/incendio/firecloud/version"
)

// MinimumHeartbeatInterval is used to prevent a user from setting the MicroCluster
// heartbeat to 0.
const MinimumHeartbeatInterval = time.Millisecond * 200

// LXDInitializationTimeout is the time limit for LXD initialization for firecloud daemon.
const LXDInitializationTimeout time.Duration = 1 * time.Minute

// Debug indicates whether to log debug messages or not.
var Debug bool

// Verbose indicates verbosity.
var Verbose bool

type cmdGlobal struct {
	cmd *cobra.Command //nolint:unused // FIXME: Remove the nolint flag when this is in use.

	flagHelp    bool
	flagVersion bool

	flagLogDebug   bool
	flagLogVerbose bool
}

type cmdDaemon struct {
	global *cmdGlobal

	flagFirecloudDir     string
	flagHeartbeatInterval time.Duration
}

// command returns the main firecloudd command.
func (c *cmdDaemon) command() *cobra.Command {
	cmd := &cobra.Command{
		Use:     "firecloudd",
		Short:   "Firecloud daemon",
		Version: version.Version(),
	}

	cmd.RunE = c.run

	return cmd
}

// run runs the main firecloudd command.
func (c *cmdDaemon) run(cmd *cobra.Command, args []string) error {
	if len(args) != 0 {
		return cmd.Help()
	}

	if c.flagHeartbeatInterval < MinimumHeartbeatInterval {
		return fmt.Errorf("Invalid heartbeat interval: Must be >%s", MinimumHeartbeatInterval)
	}

	addr := util.NetworkInterfaceAddress()
	name, err := os.Hostname()
	if err != nil {
		return fmt.Errorf("Failed to retrieve system hostname: %w", err)
	}

	services := []types.ServiceType{types.Firecloud, types.LXD}
	optionalServices := map[types.ServiceType]string{
		types.MicroCeph: api.MicroCephDir,
		types.MicroOVN:  api.MicroOVNDir,
	}

	for serviceType, stateDir := range optionalServices {
		if service.Exists(serviceType, stateDir) {
			services = append(services, serviceType)
		} else {
			logger.Infof("Skipping %s service, could not detect state directory", serviceType)
		}
	}

	s, err := service.NewHandler(name, addr, c.flagFirecloudDir, services...)
	if err != nil {
		return err
	}

	// Periodically check if new services have been installed.
	go func() {
		for {
			for serviceName, stateDir := range optionalServices {
				if service.Exists(serviceName, stateDir) {
					if s.Services[serviceName] != nil {
						continue
					}

					newService, err := service.NewHandler(name, addr, c.flagFirecloudDir, serviceName)
					if err != nil {
						logger.Error("Failed to create servie handler for service", logger.Ctx{"service": serviceName, "error": err})
						break
					}

					s.Services[serviceName] = newService.Services[serviceName]
				} else if s.Services[serviceName] != nil {
					delete(s.Services, serviceName)
				}
			}

			time.Sleep(1 * time.Second)
		}
	}()

	s.Sync = service.NewSyncer(s)

	endpoints := []microTypes.Endpoint{
		api.SyncCmd(s),
		api.UICmd(s),
		api.FreePartitionsCmd(s),
		api.StatusCmd(s),
		api.ServicesCmd(s),
		api.ServiceTokensCmd(s),
		api.ServicesClusterCmd(s),
		api.SessionJoinCmd(s),
		api.SessionInitiatingCmd(s),
		api.SessionJoiningCmd(s),
		api.SessionStopCmd(s),
		api.LXDProxy(s),
		api.CephProxy(s),
		api.OVNProxy(s),
	}

	setHandlerAddress := func(url string) error {
		addrPort, err := microTypes.ParseAddrPort(url)
		if err != nil {
			return err
		}

		if addrPort != (microTypes.AddrPort{}) {
			s.SetAddress(addrPort.Addr().String())
		}

		return nil
	}

	err = logger.InitLogger("", "", c.global.flagLogVerbose, c.global.flagLogDebug, nil)
	if err != nil {
		return err
	}

	var backgroundTasks *errgroup.Group

	dargs := microcluster.DaemonArgs{
		Version:           version.RawVersion,
		HeartbeatInterval: c.flagHeartbeatInterval,

		PreInitListenAddress: "[::]:" + strconv.FormatInt(service.CloudPort, 10),
		Hooks: &microTypes.Hooks{
			PostBootstrap: func(ctx context.Context, state microTypes.State, initConfig map[string]string) error {
				return setHandlerAddress(state.Address().Host)
			},
			PostJoin: func(ctx context.Context, state microTypes.State, cfg map[string]string) error {
				// If the node has joined close the session.
				// This will signal to the client to exit out gracefully
				// and ultimately lead to the closing of the websocket connection.
				// Prevent blocking of the hook by also watching the outer context.
				select {
				case s.Session.ExitCh() <- true:
				case <-ctx.Done():
				}

				return setHandlerAddress(state.Address().Host)
			},
			OnStart: func(ctx context.Context, state microTypes.State) error {
				g, backgroundTasksCtx := errgroup.WithContext(ctx)
				backgroundTasks = g
				s.Sync.Ready = func(ctx context.Context) bool {
					return state.Database().IsOpen(ctx) == nil
				}

				g.Go(func() error {
					s.Sync.Run(backgroundTasksCtx)

					return nil
				})

				// If we are already initialized, there's nothing to do.
				err := state.Database().IsOpen(ctx)
				// If we encounter a non-503 error, that means the database failed for some reason.
				if err != nil && !lxdAPI.StatusErrorCheck(err, http.StatusServiceUnavailable) {
					return nil
				}

				databaseReady := err == nil

				// With a 503 error or no error, we can be sure there is an address trying to connect to dqlite, so we can proceed with the handler address update.
				err = setHandlerAddress(state.Address().Host)
				if err != nil {
					return err
				}

				if !databaseReady {
					return nil
				}

				// Create initialization context with timeout defined in LXDInitializationTimeout.
				initializationCtx, cancel := context.WithTimeout(ctx, LXDInitializationTimeout)
				defer cancel()

				// Check if LXD is initialized using initializationCtx.
				initialized, err := s.Services[types.LXD].IsInitialized(initializationCtx)
				if err != nil {
					return err
				}

				if !initialized {
					return nil
				}

				// If the Firecloud database is online, and LXD is initialized, try to set user.firecloud.
				c, err := s.Services[types.LXD].(*service.LXDService).Client(context.Background())
				if err != nil {
					return err
				}

				// Don't error out in case there's an issue with LXD and we need to manage it with Firecloud.
				currentServer, etag, err := c.GetServer()
				if err != nil {
					logger.Error("Failed to retrieve LXD configuration on start", logger.Ctx{"error": err})

					return nil
				}

				newServer := currentServer.Writable()
				val, ok := newServer.Config["user.firecloud"]
				if ok && val == version.RawVersion {
					return nil
				}

				newServer.Config["user.firecloud"] = version.RawVersion

				// Don't error out in case there's an issue with LXD and we need to manage it with Firecloud.
				err = c.UpdateServer(newServer, etag)
				if err != nil {
					logger.Error("Failed to update LXD configuration on start", logger.Ctx{"error": err})
				}

				return nil
			},
			OnNewMember: func(ctx context.Context, state microTypes.State, newMember microTypes.ClusterMemberLocal) error {
				s.Sync.Trigger()

				return nil
			},
			PostRemove: func(ctx context.Context, state microTypes.State, force bool) error {
				s.Sync.Trigger()

				return nil
			},
			OnStop: func(ctx context.Context, state microTypes.State) error {
				if backgroundTasks == nil {
					return nil
				}

				err := backgroundTasks.Wait()
				if err != nil {
					return fmt.Errorf("Failed stopping background tasks: %w", err)
				}

				return nil
			},
		},

		ExtensionServers: map[string]microTypes.Server{
			"firecloud": {
				CoreAPI:   true,
				PreInit:   true,
				ServeUnix: true,
				Resources: []microTypes.Resources{
					{
						PathPrefix: types.APIVersion,
						Endpoints:  endpoints,
					},
				},
			},
		},
	}

	return s.Services[types.Firecloud].(*service.CloudService).StartCloud(context.Background(), dargs)
}

func main() {
	// Only root should run this
	if os.Geteuid() != 0 {
		fmt.Fprintln(os.Stderr, "This must be run as root")
		os.Exit(1)
	}

	daemonCmd := cmdDaemon{global: &cmdGlobal{}}
	app := daemonCmd.command()
	app.SilenceUsage = true
	app.CompletionOptions = cobra.CompletionOptions{DisableDefaultCmd: true}

	app.PersistentFlags().BoolVarP(&daemonCmd.global.flagHelp, "help", "h", false, "Print help")
	app.PersistentFlags().BoolVar(&daemonCmd.global.flagVersion, "version", false, "Print version number")
	app.PersistentFlags().BoolVarP(&daemonCmd.global.flagLogDebug, "debug", "d", false, "Show all debug messages")
	app.PersistentFlags().BoolVarP(&daemonCmd.global.flagLogVerbose, "verbose", "v", false, "Show all information messages")

	app.PersistentFlags().StringVar(&daemonCmd.flagFirecloudDir, "state-dir", api.FirecloudDir, "Path to store state information for Firecloud"+"``")
	app.PersistentFlags().DurationVar(&daemonCmd.flagHeartbeatInterval, "heartbeat", time.Second*10, "Time between attempted heartbeats")

	app.SetVersionTemplate("{{.Version}}\n")

	err := app.Execute()
	if err != nil {
		os.Exit(1)
	}
}
