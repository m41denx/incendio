package main

import (
	"errors"
	"fmt"
	"strings"

	"github.com/canonical/lxd/shared/units"
)

// diskTypeLoop marks loop-file rows in the disk selection tables.
const diskTypeLoop = "loop"

// minLoopSize is the smallest loop file offered for Ceph or local storage.
const minLoopSize = 4 << 30

// parseLoopSize reads a size such as "50GiB" or "50G" for a loop file and
// returns it in whole GiB. Empty input means no loop file (0).
func parseLoopSize(input string) (uint64, error) {
	input = strings.TrimSpace(input)
	if input == "" {
		return 0, nil
	}

	if !strings.HasSuffix(input, "B") {
		input += "iB"
	}

	size, err := units.ParseByteSizeString(input)
	if err != nil {
		return 0, fmt.Errorf("Invalid size %q: %w", input, err)
	}

	if size < minLoopSize {
		return 0, errors.New("Loop files must be at least 4GiB")
	}

	return uint64(size) >> 30, nil
}

// cephLoopSpec is MicroCeph's disk spec for one file-backed OSD of sizeGiB.
func cephLoopSpec(sizeGiB uint64) string {
	return fmt.Sprintf("loop,%dG,1", sizeGiB)
}

// isLoopSpec tells MicroCeph loop specs apart from device paths.
func isLoopSpec(path string) bool {
	return strings.HasPrefix(path, "loop,")
}

// localLoopSpec marks a loop-backed local pool of sizeGiB in the disk table.
func localLoopSpec(sizeGiB uint64) string {
	return fmt.Sprintf("loop:%dGiB", sizeGiB)
}

// localLoopSize returns the Incus size of a localLoopSpec, and whether path is one.
func localLoopSize(path string) (string, bool) {
	size, ok := strings.CutPrefix(path, "loop:")
	return size, ok
}
