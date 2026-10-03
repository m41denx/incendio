// Package version provides shared version information.
package version

// RawVersion is the current daemon version of Firecloud, set at build time
// (packaging/build-deb.sh). Members compare it when forming a cluster.
var RawVersion = "0.1.0-dev"

// Upstream is the MicroCloud release Firecloud is based on.
const Upstream = "MicroCloud 3.3"

// Version returns the version with the MicroCloud release it is based on.
func Version() string {
	return RawVersion + " (based on " + Upstream + ")"
}
