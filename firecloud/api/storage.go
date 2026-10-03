package api

import (
	"net/http"

	microTypes "github.com/canonical/microcluster/v3/microcluster/types"

	"github.com/m41denx/incendio/firecloud/service"
)

// FreePartitionsCmd represents the /1.0/storage/free-partitions API on
// Firecloud: the partitions of this machine that storage can use (see
// service.FreePartitions). Peers query it while the cluster is being formed.
var FreePartitionsCmd = func(sh *service.Handler) microTypes.Endpoint {
	return microTypes.Endpoint{
		AllowedBeforeInit: true,
		Name:              "storage/free-partitions",
		Path:              "storage/free-partitions",

		Get: microTypes.EndpointAction{Handler: authHandlerMTLS(sh, freePartitionsGet), ProxyTarget: true},
	}
}

func freePartitionsGet(s microTypes.State, r *http.Request) microTypes.Response {
	partitions, err := service.FreePartitions(r.Context())
	if err != nil {
		return microTypes.SmartError(err)
	}

	return microTypes.SyncResponse(true, partitions)
}
