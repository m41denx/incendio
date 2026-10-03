package integration

import (
	"fmt"
	"regexp"
	"slices"
	"sort"
	"strconv"
	"strings"
)

// Clustered LVM (Incus's lvmcluster driver) locks a shared device through
// lvmlockd and sanlock. Every member needs use_lvmlockd = 1 in lvm.conf and a
// sanlock host_id in lvmlocal.conf that no other member uses, ever.

// LVMConf and LVMLocalConf are the files Firecloud edits.
const (
	LVMConf      = "/etc/lvm/lvm.conf"
	LVMLocalConf = "/etc/lvm/lvmlocal.conf"
)

// KeyLVMHostIDs is the cluster-wide Incus key recording each member's
// host_id, as "name=id,name=id". Entries of removed members stay so their
// ids are never handed out again.
const KeyLVMHostIDs = "user.firecloud.lvm_host_ids"

// maxHostID is sanlock's upper bound for host_id.
const maxHostID = 2000

// ParseHostIDs reads the KeyLVMHostIDs value.
func ParseHostIDs(value string) (map[string]int, error) {
	ids := map[string]int{}
	for _, entry := range strings.Split(value, ",") {
		entry = strings.TrimSpace(entry)
		if entry == "" {
			continue
		}

		name, idStr, ok := strings.Cut(entry, "=")
		if !ok {
			return nil, fmt.Errorf("Invalid host_id entry %q", entry)
		}

		id, err := strconv.Atoi(idStr)
		if err != nil || id < 1 || id > maxHostID {
			return nil, fmt.Errorf("Invalid host_id %q for %q", idStr, name)
		}

		ids[name] = id
	}

	return ids, nil
}

// FormatHostIDs writes the KeyLVMHostIDs value, sorted by id.
func FormatHostIDs(ids map[string]int) string {
	names := make([]string, 0, len(ids))
	for name := range ids {
		names = append(names, name)
	}

	sort.Slice(names, func(i, j int) bool { return ids[names[i]] < ids[names[j]] })

	parts := make([]string, 0, len(names))
	for _, name := range names {
		parts = append(parts, fmt.Sprintf("%s=%d", name, ids[name]))
	}

	return strings.Join(parts, ",")
}

// AssignHostIDs gives every member without one the next id after the highest
// ever handed out. Existing entries are kept as they are.
func AssignHostIDs(existing map[string]int, members []string) (map[string]int, error) {
	out := make(map[string]int, len(existing)+len(members))
	highest := 0
	for name, id := range existing {
		out[name] = id
		highest = max(highest, id)
	}

	sorted := slices.Clone(members)
	slices.Sort(sorted)
	for _, name := range sorted {
		_, ok := out[name]
		if ok {
			continue
		}

		highest++
		if highest > maxHostID {
			return nil, fmt.Errorf("No sanlock host_id left for %q", name)
		}

		out[name] = highest
	}

	return out, nil
}

var useLvmlockdLine = regexp.MustCompile(`(?m)^[ \t]*#?[ \t]*use_lvmlockd[ \t]*=[ \t]*\d+[ \t]*$`)
var globalSection = regexp.MustCompile(`(?m)^global[ \t]*\{[ \t]*$`)

// EnableLvmlockd returns lvm.conf content with use_lvmlockd = 1 in the global
// section: the existing (possibly commented) setting is replaced, or one is
// added at the top of the section.
func EnableLvmlockd(content string) (string, error) {
	loc := useLvmlockdLine.FindStringIndex(content)
	if loc != nil {
		return content[:loc[0]] + "\tuse_lvmlockd = 1" + content[loc[1]:], nil
	}

	loc = globalSection.FindStringIndex(content)
	if loc != nil {
		return content[:loc[1]] + "\n\tuse_lvmlockd = 1" + content[loc[1]:], nil
	}

	if strings.TrimSpace(content) == "" {
		return "global {\n\tuse_lvmlockd = 1\n}\n", nil
	}

	return "", fmt.Errorf("No global section found in %s", LVMConf)
}

// LockdEnabled reports whether lvm.conf content enables lvmlockd.
func LockdEnabled(content string) bool {
	for _, line := range strings.Split(content, "\n") {
		key, value, ok := strings.Cut(strings.TrimSpace(line), "=")
		if ok && strings.TrimSpace(key) == "use_lvmlockd" {
			return strings.TrimSpace(value) == "1"
		}
	}

	return false
}

// LocalConf returns the lvmlocal.conf Firecloud writes for a member.
func LocalConf(hostID int) string {
	return fmt.Sprintf(`# Managed by Firecloud: the sanlock host_id of this member for clustered LVM.
# Every member of the cluster has a different one. Do not edit.
local {
	host_id = %d
}
`, hostID)
}
