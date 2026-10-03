package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestCheckOpenFGA(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer key" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		if r.URL.Path != "/stores/01STORE" {
			w.WriteHeader(http.StatusNotFound)
			return
		}

		_, _ = w.Write([]byte(`{"id":"01STORE","name":"incus"}`))
	}))
	defer srv.Close()

	ctx := context.Background()
	require.NoError(t, checkOpenFGA(ctx, &openFGAConfig{URL: srv.URL + "/", Token: "key", StoreID: "01STORE"}))
	require.ErrorContains(t, checkOpenFGA(ctx, &openFGAConfig{URL: srv.URL, Token: "nope", StoreID: "01STORE"}), "token")
	require.ErrorContains(t, checkOpenFGA(ctx, &openFGAConfig{URL: srv.URL, Token: "key", StoreID: "OTHER"}), "store")
	require.ErrorContains(t, checkOpenFGA(ctx, &openFGAConfig{URL: "http://127.0.0.1:1", StoreID: "x"}), "not reachable")
}
