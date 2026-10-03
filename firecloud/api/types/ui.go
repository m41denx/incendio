package types

// UIPut asks a member to install an Incendio UI release.
type UIPut struct {
	// Tag is the release to install; empty means the latest.
	Tag string `json:"tag" yaml:"tag"`
}
