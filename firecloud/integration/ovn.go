// Package integration wires the MicroOVN and MicroCeph snaps into Incus.
//
// The LXD snap reads MicroOVN's connection string itself and gets Ceph's
// configuration through snap content interfaces. Incus from the Zabbly
// packages has neither, so Firecloud copies the values over: OVN settings
// into the Incus server configuration and Ceph files into /etc/ceph. The
// functions here only read and compare; the daemon applies the results.
package integration

import (
	"bufio"
	"bytes"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// MicroOVNRoot is where the MicroOVN snap keeps its data.
const MicroOVNRoot = "/var/snap/microovn/common"

// OVSConnection is the Open vSwitch database socket of the MicroOVN snap.
const OVSConnection = "unix:/var/snap/microovn/common/run/switch/db.sock"

// Incus server configuration keys Firecloud keeps in step with MicroOVN.
const (
	KeyNorthbound = "network.ovn.northbound_connection"
	KeyCACert     = "network.ovn.ca_cert"
	KeyClientCert = "network.ovn.client_cert"
	KeyClientKey  = "network.ovn.client_key"
	// KeyOVSConnection is member-specific: every member sets its own.
	KeyOVSConnection = "network.ovs.connection"
)

// OVNState is what Incus needs from the local MicroOVN.
type OVNState struct {
	Northbound string
	CACert     string
	ClientCert string
	ClientKey  string
}

// ReadOVN reads the local MicroOVN state below root (MicroOVNRoot outside tests).
func ReadOVN(root string) (*OVNState, error) {
	env, err := readEnv(filepath.Join(root, "data", "env", "ovn.env"))
	if err != nil {
		return nil, err
	}

	northbound := env["OVN_NB_CONNECT"]
	if northbound == "" {
		return nil, errors.New("MicroOVN's ovn.env has no OVN_NB_CONNECT yet")
	}

	pki := filepath.Join(root, "data", "pki")
	files := map[string]*string{}
	state := &OVNState{Northbound: northbound}
	files["cacert.pem"] = &state.CACert
	files["client-cert.pem"] = &state.ClientCert
	files["client-privkey.pem"] = &state.ClientKey
	for name, target := range files {
		content, err := os.ReadFile(filepath.Join(pki, name))
		if err != nil {
			return nil, fmt.Errorf("Failed to read MicroOVN certificate: %w", err)
		}

		*target = strings.TrimSpace(string(content))
	}

	return state, nil
}

// GlobalConfig returns the cluster-wide Incus keys for this state.
func (s OVNState) GlobalConfig() map[string]string {
	return map[string]string{
		KeyNorthbound: s.Northbound,
		KeyCACert:     s.CACert,
		KeyClientCert: s.ClientCert,
		KeyClientKey:  s.ClientKey,
	}
}

// Changes returns the keys of want whose values differ in current.
// Certificates are compared without surrounding whitespace, as Incus may
// store them with or without a trailing newline.
func Changes(current map[string]string, want map[string]string) map[string]string {
	out := map[string]string{}
	for key, value := range want {
		if strings.TrimSpace(current[key]) != strings.TrimSpace(value) {
			out[key] = value
		}
	}

	return out
}

// readEnv parses a shell-style KEY="value" file, ignoring comments.
func readEnv(path string) (map[string]string, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("Failed to read %s: %w", path, err)
	}

	env := map[string]string{}
	scanner := bufio.NewScanner(bytes.NewReader(content))
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}

		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}

		unquoted, err := strconv.Unquote(value)
		if err == nil {
			value = unquoted
		}

		env[strings.TrimSpace(key)] = value
	}

	return env, scanner.Err()
}
