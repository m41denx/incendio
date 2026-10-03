package main

import (
	"context"
	"fmt"

	"github.com/canonical/microcluster/v3/microcluster"
	"github.com/spf13/cobra"

	cloudClient "github.com/m41denx/incendio/firecloud/client"
)

type cmdRemove struct {
	common *CmdControl

	flagForce bool
}

// command returns the subcommand to remove a member from all Firecloud services.
func (c *cmdRemove) command() *cobra.Command {
	cmd := &cobra.Command{
		Use:     "remove <name>",
		Aliases: []string{"rm"},
		Short:   "Remove the specified member from all Firecloud services",
		RunE:    c.run,
	}

	cmd.Flags().BoolVarP(&c.flagForce, "force", "f", false, "Forcibly remove the cluster member")

	return cmd
}

// run runs the subcommand to remove a member from all Firecloud services.
func (c *cmdRemove) run(cmd *cobra.Command, args []string) error {
	if len(args) != 1 {
		return cmd.Help()
	}

	options := microcluster.Args{StateDir: c.common.FlagFirecloudDir}
	m, err := microcluster.App(options)
	if err != nil {
		return err
	}

	err = m.Ready(context.Background())
	if err != nil {
		return fmt.Errorf("Failed to wait for Firecloud to get ready: %w", err)
	}

	client, err := m.LocalClient()
	if err != nil {
		return err
	}

	return cloudClient.DeleteClusterMember(context.Background(), client, args[0], c.flagForce)
}
