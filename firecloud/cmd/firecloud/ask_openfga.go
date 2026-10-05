package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/m41denx/incendio/firecloud/api/types"
	"github.com/m41denx/incendio/firecloud/cmd/tui"
	"github.com/m41denx/incendio/firecloud/service"
)

// openFGAConfig connects Incus to an existing OpenFGA server.
type openFGAConfig struct {
	URL       string
	Token     string
	StoreID   string
	RouteOIDC bool
}

// askOpenFGA asks whether to authorize users through an existing OpenFGA
// server, and tests the connection from this system.
func (c *initConfig) askOpenFGA() (*openFGAConfig, error) {
	want, err := c.asker.AskBool("Would you like to connect Incus to an OpenFGA server for fine-grained permissions?", false)
	if err != nil || !want {
		return nil, err
	}

	cfg := &openFGAConfig{}
	err = c.askRetry("Retry the OpenFGA settings?", func() error {
		cfg.URL, err = c.asker.AskString("OpenFGA API URL (e.g. https://openfga.internal:8080):", "", func(input string) error {
			u, err := url.Parse(input)
			if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
				return errors.New("Enter an http(s) URL")
			}

			return nil
		})
		if err != nil {
			return err
		}

		cfg.Token, err = c.asker.AskString("OpenFGA API token (one of its preshared keys, empty for none):", "", func(string) error { return nil })
		if err != nil {
			return err
		}

		cfg.StoreID, err = c.asker.AskString("OpenFGA store ID:", "", func(input string) error {
			if strings.TrimSpace(input) == "" {
				return errors.New("A store ID is required")
			}

			return nil
		})
		if err != nil {
			return err
		}

		return checkOpenFGA(context.Background(), cfg)
	})
	if err != nil {
		return nil, err
	}

	fmt.Println(tui.SummarizeResult("OpenFGA store %s answers at %s", cfg.StoreID, cfg.URL))

	cfg.RouteOIDC, err = c.asker.AskBool("Authorize OIDC (SSO) users through OpenFGA? Without this, every OIDC user is a full admin once OIDC is set up, unless you route them to an authorization scriptlet (Incus 7.5+ passes it the token claims)", true)
	if err != nil {
		return nil, err
	}

	return cfg, nil
}

// checkOpenFGA reads the store, which checks the URL, token and store ID.
func checkOpenFGA(ctx context.Context, cfg *openFGAConfig) error {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(cfg.URL, "/")+"/stores/"+url.PathEscape(cfg.StoreID), nil)
	if err != nil {
		return err
	}

	if cfg.Token != "" {
		req.Header.Set("Authorization", "Bearer "+cfg.Token)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("OpenFGA is not reachable from this system: %w", err)
	}

	_ = resp.Body.Close()
	switch resp.StatusCode {
	case http.StatusOK:
		return nil
	case http.StatusUnauthorized, http.StatusForbidden:
		return errors.New("OpenFGA rejected the API token")
	case http.StatusNotFound:
		return errors.New("OpenFGA does not know this store")
	}

	return fmt.Errorf("OpenFGA answered %s", resp.Status)
}

// applyOpenFGA writes the OpenFGA settings into the Incus cluster
// configuration. Trusted TLS clients stay on "allow" so certificate logins
// keep full access.
func applyOpenFGA(sh *service.Handler, cfg *openFGAConfig) error {
	lxd := sh.Services[types.LXD].(*service.LXDService)
	client, err := lxd.Client(context.Background())
	if err != nil {
		return err
	}

	server, etag, err := client.GetServer()
	if err != nil {
		return err
	}

	prefix := "openfga."
	if client.HasExtension("authorization_config") {
		prefix = "authorization.openfga."
	}

	put := server.Writable()
	put.Config[prefix+"api.url"] = cfg.URL
	put.Config[prefix+"api.token"] = cfg.Token
	put.Config[prefix+"store.id"] = cfg.StoreID
	if cfg.RouteOIDC {
		if client.HasExtension("authorization_client_routing") {
			put.Config["authorization.client.oidc"] = "openfga"
		} else {
			tui.PrintWarning("This Incus version cannot route OIDC users separately; OpenFGA authorizes all remote clients")
		}
	}

	err = client.UpdateServer(put, etag)
	if err != nil {
		return fmt.Errorf("Failed to configure OpenFGA: %w", err)
	}

	return nil
}
