package service

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"
)

// MinPartitionSize is the smallest partition offered for storage (1 GiB).
const MinPartitionSize = 1 << 30

// Partition types that never hold data even without a filesystem.
var reservedPartTypes = map[string]bool{
	"21686148-6449-6e6f-744e-656564454649": true, // BIOS boot
	"e3c9e316-0b5c-4db8-817d-f92df00215ae": true, // Microsoft reserved
	"0x5":                                  true, // MBR extended
	"0xf":                                  true, // MBR extended (LBA)
	"0x85":                                 true, // Linux extended
}

type lsblkDevice struct {
	Name        string        `json:"name"`
	Type        string        `json:"type"`
	FSType      *string       `json:"fstype"`
	PartType    *string       `json:"parttype"`
	Mountpoints []*string     `json:"mountpoints"`
	Size        uint64        `json:"size"`
	Children    []lsblkDevice `json:"children"`
}

// FreePartitions lists the partitions on this machine that can be given to
// storage: no filesystem or other signature, not mounted, not used by LVM,
// RAID or device-mapper, and at least MinPartitionSize. Names are kernel
// names such as "sda3".
func FreePartitions(ctx context.Context) ([]string, error) {
	out, err := exec.CommandContext(ctx, "lsblk", "-J", "-b", "-o", "NAME,TYPE,FSTYPE,PARTTYPE,MOUNTPOINTS,SIZE").Output()
	if err != nil {
		return nil, fmt.Errorf("lsblk: %w", err)
	}

	return ParseFreePartitions(out)
}

// ParseFreePartitions applies FreePartitions' rules to lsblk -J output.
func ParseFreePartitions(lsblkJSON []byte) ([]string, error) {
	var tree struct {
		Blockdevices []lsblkDevice `json:"blockdevices"`
	}

	err := json.Unmarshal(lsblkJSON, &tree)
	if err != nil {
		return nil, fmt.Errorf("Failed to parse lsblk output: %w", err)
	}

	free := []string{}
	var walk func(devices []lsblkDevice)
	walk = func(devices []lsblkDevice) {
		for _, d := range devices {
			if d.Type == "part" && partitionFree(d) {
				free = append(free, d.Name)
			}

			walk(d.Children)
		}
	}

	walk(tree.Blockdevices)

	return free, nil
}

func partitionFree(d lsblkDevice) bool {
	if d.FSType != nil && *d.FSType != "" {
		return false
	}

	if d.PartType != nil && reservedPartTypes[strings.ToLower(*d.PartType)] {
		return false
	}

	for _, m := range d.Mountpoints {
		if m != nil && *m != "" {
			return false
		}
	}

	// Holders (LVM, RAID, crypt) show as children.
	if len(d.Children) > 0 {
		return false
	}

	return d.Size >= MinPartitionSize
}
