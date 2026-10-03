package integration

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
)

// MicroCephConf is where the MicroCeph snap writes the client configuration.
const MicroCephConf = "/var/snap/microceph/current/conf"

// CephConfDir is where Incus's Ceph driver and the ceph/rbd tools look.
const CephConfDir = "/etc/ceph"

// cephFiles maps MicroCeph's files to the names the Ceph tools expect, with
// their modes. The admin keyring is root-only.
var cephFiles = []struct {
	from string
	to   string
	mode os.FileMode
}{
	{"ceph.conf", "ceph.conf", 0o644},
	{"ceph.keyring", "ceph.client.admin.keyring", 0o600},
}

// SyncCeph copies MicroCeph's configuration from src into dst when it
// differs, replacing each file atomically. It returns the files it wrote.
func SyncCeph(src string, dst string) ([]string, error) {
	err := os.MkdirAll(dst, 0o755)
	if err != nil {
		return nil, err
	}

	written := []string{}
	for _, f := range cephFiles {
		content, err := os.ReadFile(filepath.Join(src, f.from))
		if err != nil {
			return written, fmt.Errorf("Failed to read MicroCeph's %s: %w", f.from, err)
		}

		target := filepath.Join(dst, f.to)
		changed, err := writeIfChanged(target, content, f.mode)
		if err != nil {
			return written, err
		}

		if changed {
			written = append(written, target)
		}
	}

	return written, nil
}

// writeIfChanged writes content to path through a temporary file and a
// rename, unless the file already holds exactly that content and mode.
func writeIfChanged(path string, content []byte, mode os.FileMode) (bool, error) {
	current, err := os.ReadFile(path)
	if err == nil && bytes.Equal(current, content) {
		info, err := os.Stat(path)
		if err == nil && info.Mode().Perm() == mode {
			return false, nil
		}
	}

	tmp, err := os.CreateTemp(filepath.Dir(path), "."+filepath.Base(path)+".*")
	if err != nil {
		return false, err
	}

	defer func() { _ = os.Remove(tmp.Name()) }()

	err = tmp.Chmod(mode)
	if err == nil {
		_, err = tmp.Write(content)
	}

	if err == nil {
		err = tmp.Sync()
	}

	closeErr := tmp.Close()
	if err == nil {
		err = closeErr
	}

	if err != nil {
		return false, fmt.Errorf("Failed to write %s: %w", path, err)
	}

	err = os.Rename(tmp.Name(), path)
	if err != nil {
		return false, fmt.Errorf("Failed to replace %s: %w", path, err)
	}

	return true, nil
}
