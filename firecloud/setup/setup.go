// Package setup installs what Firecloud runs with: Incus from the Zabbly
// repository, the MicroOVN and MicroCeph snaps, the tools for TrueNAS and
// clustered LVM pools, and the Incendio web UI.
package setup

import (
	"archive/zip"
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	incus "github.com/lxc/incus/v7/client"

	"github.com/m41denx/incendio/firecloud/integration"
)

// Locations and defaults.
const (
	ZabblyKeyURL   = "https://pkgs.zabbly.com/key.asc"
	zabblyKeyring  = "/etc/apt/keyrings/zabbly.asc"
	zabblySources  = "/etc/apt/sources.list.d/zabbly-incus-stable.sources"
	incusSocket    = "/var/lib/incus/unix.socket"
	UIDir          = "/opt/incus/ui"
	incendioRepo   = "m41denx/incendio"
	truenasCtlRepo = "truenas/truenas_incus_ctl"

	DefaultOVNChannel  = "26.03/stable"
	DefaultCephChannel = "tentacle/stable"
)

// RefuseInitializedIncus returns an error when Incus is already running with storage
// pools or managed networks: Firecloud only sets up new clusters.
func RefuseInitializedIncus() error {
	_, err := os.Stat(incusSocket)
	if err != nil {
		return nil
	}

	client, err := incus.ConnectIncusUnix(incusSocket, nil)
	if err != nil {
		return nil
	}

	pools, err := client.GetStoragePoolNames()
	if err == nil && len(pools) > 0 {
		return fmt.Errorf("Incus already has storage pools (%s); Firecloud only sets up new clusters", strings.Join(pools, ", "))
	}

	networks, err := client.GetNetworks()
	if err == nil {
		for _, n := range networks {
			if n.Managed {
				return fmt.Errorf("Incus already has a managed network (%s); Firecloud only sets up new clusters", n.Name)
			}
		}
	}

	return nil
}

// InstallIncus adds the Zabbly stable repository and installs Incus.
func InstallIncus(ctx context.Context) error {
	err := os.MkdirAll(filepath.Dir(zabblyKeyring), 0o755)
	if err != nil {
		return err
	}

	key, err := download(ctx, ZabblyKeyURL)
	if err != nil {
		return err
	}

	_, err = integration.WriteIfChanged(zabblyKeyring, key, 0o644)
	if err != nil {
		return err
	}

	codename, err := osReleaseValue("VERSION_CODENAME")
	if err != nil {
		return err
	}

	arch, err := output(ctx, "dpkg", "--print-architecture")
	if err != nil {
		return err
	}

	sources := fmt.Sprintf(`Enabled: yes
Types: deb
URIs: https://pkgs.zabbly.com/incus/stable
Suites: %s
Components: main
Architectures: %s
Signed-By: %s
`, codename, arch, zabblyKeyring)

	_, err = integration.WriteIfChanged(zabblySources, []byte(sources), 0o644)
	if err != nil {
		return err
	}

	err = Run(ctx, "apt-get", "update", "-q")
	if err != nil {
		return err
	}

	return AptInstall(ctx, "incus")
}

// InstallSnap installs a snap, or moves it to the channel when already installed.
func InstallSnap(ctx context.Context, name string, channel string) error {
	err := exec.CommandContext(ctx, "snap", "list", name).Run()
	if err == nil {
		return Run(ctx, "snap", "refresh", name, "--channel="+channel)
	}

	return Run(ctx, "snap", "install", name, "--channel="+channel)
}

// InstallTrueNAS installs open-iscsi and the truenas_incus_ctl package from
// its latest GitHub release, which Incus's truenas driver needs.
func InstallTrueNAS(ctx context.Context) error {
	err := AptInstall(ctx, "open-iscsi")
	if err != nil {
		return err
	}

	arch, err := output(ctx, "dpkg", "--print-architecture")
	if err != nil {
		return err
	}

	release, err := latestRelease(ctx, truenasCtlRepo, func(r githubRelease) string {
		for _, a := range r.Assets {
			if strings.HasSuffix(a.Name, "_"+arch+".deb") {
				return a.URL
			}
		}

		return ""
	})
	if err != nil {
		return err
	}

	content, err := download(ctx, release.asset)
	if err != nil {
		return err
	}

	path := filepath.Join(os.TempDir(), "truenas_incus_ctl_"+arch+".deb")
	err = os.WriteFile(path, content, 0o644)
	if err != nil {
		return err
	}

	defer func() { _ = os.Remove(path) }()

	err = AptInstall(ctx, path)
	if err != nil {
		return err
	}

	fmt.Println("Log in to your TrueNAS server before creating the pool: truenas_incus_ctl config login")

	return nil
}

// InstallLVMCluster installs the clustered LVM tools and enables lvmlockd.
// The member's sanlock host_id is written by the daemon once assigned.
func InstallLVMCluster(ctx context.Context) error {
	err := AptInstall(ctx, "lvm2", "lvm2-lockd", "sanlock")
	if err != nil {
		return err
	}

	content, err := os.ReadFile(integration.LVMConf)
	if err != nil {
		return err
	}

	updated, err := integration.EnableLvmlockd(string(content))
	if err != nil {
		return err
	}

	_, err = integration.WriteIfChanged(integration.LVMConf, []byte(updated), 0o644)
	if err != nil {
		return err
	}

	return Run(ctx, "systemctl", "enable", "--now", "sanlock.service", "lvmlockd.service")
}

// InstallUI downloads an Incendio release bundle (the latest when tag is
// empty) and swaps it into /opt/incus/ui. It returns the installed tag.
func InstallUI(ctx context.Context, tag string) (string, error) {
	pick := func(r githubRelease) string {
		for _, a := range r.Assets {
			if strings.HasPrefix(a.Name, "incendio-ui-") && strings.HasSuffix(a.Name, ".zip") {
				return a.URL
			}
		}

		return ""
	}

	var release *pickedRelease
	var err error
	if tag == "" {
		release, err = latestRelease(ctx, incendioRepo, pick)
	} else {
		release, err = taggedRelease(ctx, incendioRepo, tag, pick)
	}

	if err != nil {
		return "", err
	}

	content, err := download(ctx, release.asset)
	if err != nil {
		return "", err
	}

	staging := UIDir + ".new"
	_ = os.RemoveAll(staging)
	err = unzip(content, staging)
	if err != nil {
		_ = os.RemoveAll(staging)
		return "", err
	}

	_, err = os.Stat(filepath.Join(staging, "index.html"))
	if err != nil {
		_ = os.RemoveAll(staging)
		return "", fmt.Errorf("Release %s has no index.html", release.tag)
	}

	old := UIDir + ".old"
	_ = os.RemoveAll(old)
	err = os.Rename(UIDir, old)
	if err != nil && !os.IsNotExist(err) {
		return "", err
	}

	err = os.Rename(staging, UIDir)
	if err != nil {
		_ = os.Rename(old, UIDir)
		return "", err
	}

	_ = os.RemoveAll(old)

	return release.tag, nil
}

func unzip(content []byte, dst string) error {
	reader, err := zip.NewReader(bytes.NewReader(content), int64(len(content)))
	if err != nil {
		return err
	}

	for _, f := range reader.File {
		target := filepath.Join(dst, f.Name)
		if !strings.HasPrefix(target, filepath.Clean(dst)+string(os.PathSeparator)) && target != filepath.Clean(dst) {
			return fmt.Errorf("Unsafe path in archive: %q", f.Name)
		}

		if f.FileInfo().IsDir() {
			err = os.MkdirAll(target, 0o755)
			if err != nil {
				return err
			}

			continue
		}

		err = os.MkdirAll(filepath.Dir(target), 0o755)
		if err != nil {
			return err
		}

		in, err := f.Open()
		if err != nil {
			return err
		}

		out, err := os.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
		if err != nil {
			_ = in.Close()
			return err
		}

		_, err = io.Copy(out, in)
		_ = in.Close()
		closeErr := out.Close()
		if err != nil {
			return err
		}

		if closeErr != nil {
			return closeErr
		}
	}

	return nil
}

type githubRelease struct {
	TagName    string `json:"tag_name"`
	Draft      bool   `json:"draft"`
	Prerelease bool   `json:"prerelease"`
	Assets     []struct {
		Name string `json:"name"`
		URL  string `json:"browser_download_url"`
	} `json:"assets"`
}

type pickedRelease struct {
	tag   string
	asset string
}

// latestRelease returns the newest published, non-pre-release release of
// repo that has an asset pick accepts. Firecloud's own releases live in the
// same repository as the UI's, so "the latest release" alone is not enough.
func latestRelease(ctx context.Context, repo string, pick func(githubRelease) string) (*pickedRelease, error) {
	content, err := download(ctx, "https://api.github.com/repos/"+repo+"/releases?per_page=50")
	if err != nil {
		return nil, err
	}

	var releases []githubRelease
	err = json.Unmarshal(content, &releases)
	if err != nil {
		return nil, err
	}

	for _, r := range releases {
		if r.Draft || r.Prerelease {
			continue
		}

		asset := pick(r)
		if asset != "" {
			return &pickedRelease{tag: r.TagName, asset: asset}, nil
		}
	}

	return nil, fmt.Errorf("No release of %s has the expected download for this machine", repo)
}

// taggedRelease returns the release of repo with the given tag.
func taggedRelease(ctx context.Context, repo string, tag string, pick func(githubRelease) string) (*pickedRelease, error) {
	content, err := download(ctx, "https://api.github.com/repos/"+repo+"/releases/tags/"+tag)
	if err != nil {
		return nil, err
	}

	var r githubRelease
	err = json.Unmarshal(content, &r)
	if err != nil {
		return nil, err
	}

	asset := pick(r)
	if asset == "" {
		return nil, fmt.Errorf("Release %s of %s has no UI bundle", tag, repo)
	}

	return &pickedRelease{tag: r.TagName, asset: asset}, nil
}

func download(ctx context.Context, url string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}

	req.Header.Set("User-Agent", "firecloud ("+runtime.GOARCH+")")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}

	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GET %s: %s", url, resp.Status)
	}

	return io.ReadAll(resp.Body)
}

// AptInstall installs packages non-interactively.
func AptInstall(ctx context.Context, packages ...string) error {
	args := append([]string{"install", "-y", "-q", "--no-install-recommends"}, packages...)
	cmd := exec.CommandContext(ctx, "apt-get", args...)
	cmd.Env = append(os.Environ(), "DEBIAN_FRONTEND=noninteractive")
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("apt-get install %s: %s", strings.Join(packages, " "), lastLines(out, 10))
	}

	return nil
}

// EnsureCommand installs pkg with apt when command is missing.
func EnsureCommand(ctx context.Context, command string, pkg string) error {
	_, err := exec.LookPath(command)
	if err == nil {
		return nil
	}

	return AptInstall(ctx, pkg)
}

// Run runs a command and returns its last lines of output on failure.
func Run(ctx context.Context, name string, args ...string) error {
	out, err := exec.CommandContext(ctx, name, args...).CombinedOutput()
	if err != nil {
		return fmt.Errorf("%s %s: %s", name, strings.Join(args, " "), lastLines(out, 10))
	}

	return nil
}

func output(ctx context.Context, name string, args ...string) (string, error) {
	out, err := exec.CommandContext(ctx, name, args...).Output()
	if err != nil {
		return "", fmt.Errorf("%s %s: %w", name, strings.Join(args, " "), err)
	}

	return strings.TrimSpace(string(out)), nil
}

func lastLines(out []byte, n int) string {
	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	if len(lines) > n {
		lines = lines[len(lines)-n:]
	}

	return strings.Join(lines, "\n")
}

func osReleaseValue(key string) (string, error) {
	f, err := os.Open("/etc/os-release")
	if err != nil {
		return "", err
	}

	defer func() { _ = f.Close() }()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		k, v, ok := strings.Cut(scanner.Text(), "=")
		if ok && k == key {
			return strings.Trim(v, `"`), nil
		}
	}

	return "", fmt.Errorf("No %s in /etc/os-release", key)
}
