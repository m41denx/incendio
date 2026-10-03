package main

import (
	"errors"
	"fmt"
	"os/exec"

	"github.com/spf13/cobra"

	"github.com/m41denx/incendio/firecloud/cmd/tui"
	"github.com/m41denx/incendio/firecloud/setup"
)

type cmdInstall struct {
	common *CmdControl

	flagNoOVN       bool
	flagCeph        bool
	flagTrueNAS     bool
	flagLVMCluster  bool
	flagNoUI        bool
	flagOVNChannel  string
	flagCephChannel string
}

func (c *cmdInstall) command() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "install",
		Short: "Install Incus and the services Firecloud sets up on this machine",
		Long: `Install Incus and the services Firecloud sets up on this machine.

Run it on every machine before "firecloud init" or "firecloud join":
- Incus from the Zabbly stable repository
- MicroOVN (unless --no-ovn)
- MicroCeph and ceph-common (--ceph)
- open-iscsi and truenas_incus_ctl for TrueNAS pools (--truenas)
- lvm2, lvm2-lockd and sanlock for clustered LVM (--lvmcluster)
- the Incendio web UI (unless --no-ui)

Incus must not be set up yet: Firecloud only builds new clusters.`,
		RunE: c.run,
	}

	cmd.Flags().BoolVar(&c.flagNoOVN, "no-ovn", false, "Do not install MicroOVN")
	cmd.Flags().BoolVar(&c.flagCeph, "ceph", false, "Install MicroCeph for distributed storage")
	cmd.Flags().BoolVar(&c.flagTrueNAS, "truenas", false, "Install the tools for TrueNAS storage pools")
	cmd.Flags().BoolVar(&c.flagLVMCluster, "lvmcluster", false, "Install the tools for clustered LVM on a shared disk")
	cmd.Flags().BoolVar(&c.flagNoUI, "no-ui", false, "Do not install the Incendio web UI")
	cmd.Flags().StringVar(&c.flagOVNChannel, "ovn-channel", setup.DefaultOVNChannel, "Snap channel for MicroOVN")
	cmd.Flags().StringVar(&c.flagCephChannel, "ceph-channel", setup.DefaultCephChannel, "Snap channel for MicroCeph")

	return cmd
}

func (c *cmdInstall) run(cmd *cobra.Command, args []string) error {
	if len(args) != 0 {
		return cmd.Help()
	}

	ctx := cmd.Context()
	_, err := exec.LookPath("apt-get")
	if err != nil {
		return errors.New("Firecloud installs packages with apt: Debian or Ubuntu is required")
	}

	err = setup.RefuseInitializedIncus()
	if err != nil {
		return err
	}

	step := func(name string, f func() error) error {
		fmt.Println(tui.Printf(tui.Fmt{Arg: "%s ..."}, tui.Fmt{Arg: name, Bold: true}))
		err := f()
		if err != nil {
			return fmt.Errorf("%s: %w", name, err)
		}

		return nil
	}

	err = step("Incus", func() error { return setup.InstallIncus(ctx) })
	if err != nil {
		return err
	}

	snaps := []struct{ name, channel string }{}
	if !c.flagNoOVN {
		snaps = append(snaps, struct{ name, channel string }{"microovn", c.flagOVNChannel})
	}

	if c.flagCeph {
		snaps = append(snaps, struct{ name, channel string }{"microceph", c.flagCephChannel})
	}

	if len(snaps) > 0 {
		err = step("snapd", func() error { return setup.EnsureCommand(ctx, "snap", "snapd") })
		if err != nil {
			return err
		}

		for _, s := range snaps {
			err = step(s.name+" ("+s.channel+")", func() error { return setup.InstallSnap(ctx, s.name, s.channel) })
			if err != nil {
				return err
			}
		}
	}

	if c.flagCeph {
		err = step("ceph-common", func() error { return setup.AptInstall(ctx, "ceph-common") })
		if err != nil {
			return err
		}
	}

	if c.flagTrueNAS {
		err = step("open-iscsi and truenas_incus_ctl", func() error { return setup.InstallTrueNAS(ctx) })
		if err != nil {
			return err
		}
	}

	if c.flagLVMCluster {
		err = step("lvm2, lvm2-lockd and sanlock", func() error { return setup.InstallLVMCluster(ctx) })
		if err != nil {
			return err
		}
	}

	if !c.flagNoUI {
		err = step("Incendio UI", func() error {
			tag, err := setup.InstallUI(ctx, "")
			if err == nil {
				fmt.Printf("Installed Incendio %s in %s\n", tag, setup.UIDir)
			}

			return err
		})
		if err != nil {
			return err
		}
	}

	err = step("Firecloud daemon", func() error { return setup.Run(ctx, "systemctl", "enable", "--now", "firecloud.service") })
	if err != nil {
		return err
	}

	fmt.Println(tui.SuccessColor("Ready. Run \"firecloud init\" on one machine and \"firecloud join\" on the others.", true))

	return nil
}
