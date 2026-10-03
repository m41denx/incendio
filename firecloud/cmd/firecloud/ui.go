package main

import (
	"context"
	"fmt"
	"slices"

	"github.com/canonical/microcluster/v3/microcluster"
	"github.com/spf13/cobra"

	cloudClient "github.com/m41denx/incendio/firecloud/client"
	"github.com/m41denx/incendio/firecloud/cmd/tui"
	"github.com/m41denx/incendio/firecloud/setup"
)

type cmdUI struct {
	common *CmdControl
}

func (c *cmdUI) command() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "ui",
		Short: "Manage the Incendio web UI",
	}

	update := cmdUIUpdate{common: c.common}
	cmd.AddCommand(update.command())

	return cmd
}

type cmdUIUpdate struct {
	common *CmdControl

	flagTag string
}

func (c *cmdUIUpdate) command() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "update",
		Short: "Install the latest Incendio release (or --tag) on every cluster member",
		RunE:  c.run,
	}

	cmd.Flags().StringVar(&c.flagTag, "tag", "", "Incendio release to install, e.g. 0.22-p17")

	return cmd
}

func (c *cmdUIUpdate) run(cmd *cobra.Command, args []string) error {
	if len(args) != 0 {
		return cmd.Help()
	}

	ctx := cmd.Context()
	cloudApp, err := microcluster.App(microcluster.Args{StateDir: c.common.FlagFirecloudDir})
	if err != nil {
		return err
	}

	local, err := cloudApp.LocalClient()
	if err != nil {
		return err
	}

	members, err := cloudClient.GetClusterMembers(ctx, local)
	if err != nil {
		// Not part of a cluster yet: update this machine only.
		tag, err := setup.InstallUI(ctx, c.flagTag)
		if err != nil {
			return err
		}

		fmt.Printf("Installed Incendio %s\n", tag)

		return nil
	}

	names := []string{}
	for _, m := range members {
		names = append(names, m.Name)
	}

	slices.Sort(names)

	failed := 0
	for _, name := range names {
		tag, err := cloudClient.UpdateUI(context.Background(), local, name, c.flagTag)
		if err != nil {
			failed++
			tui.PrintWarning(fmt.Sprintf("%s: %v", name, err))

			continue
		}

		fmt.Printf("%s: installed Incendio %s\n", name, tag)
	}

	if failed > 0 {
		return fmt.Errorf("Updating the UI failed on %d of %d members", failed, len(names))
	}

	return nil
}
