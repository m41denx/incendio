package api

import (
	"net/http"

	microTypes "github.com/canonical/microcluster/v3/microcluster/types"

	"github.com/m41denx/incendio/firecloud/service"
)

// SyncCmd represents the /1.0/sync API on Firecloud: GET returns the outcome
// of the member's last sync of OVN, Ceph and LVM settings into Incus, POST
// runs one now and returns its outcome.
var SyncCmd = func(sh *service.Handler) microTypes.Endpoint {
	return microTypes.Endpoint{
		Name: "sync",
		Path: "sync",

		Get:  microTypes.EndpointAction{Handler: syncGet(sh), ProxyTarget: true},
		Post: microTypes.EndpointAction{Handler: syncPost(sh), ProxyTarget: true},
	}
}

func syncGet(sh *service.Handler) endpointHandler {
	return func(s microTypes.State, r *http.Request) microTypes.Response {
		if sh.Sync == nil {
			return microTypes.SyncResponse(true, nil)
		}

		return microTypes.SyncResponse(true, sh.Sync.Status())
	}
}

func syncPost(sh *service.Handler) endpointHandler {
	return func(s microTypes.State, r *http.Request) microTypes.Response {
		if sh.Sync == nil {
			return microTypes.SyncResponse(true, nil)
		}

		return microTypes.SyncResponse(true, sh.Sync.Sync(r.Context()))
	}
}
