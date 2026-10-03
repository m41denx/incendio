package api

import (
	"encoding/json"
	"net/http"

	microTypes "github.com/canonical/microcluster/v3/microcluster/types"

	"github.com/m41denx/incendio/firecloud/api/types"
	"github.com/m41denx/incendio/firecloud/service"
	"github.com/m41denx/incendio/firecloud/setup"
)

// UICmd represents the /1.0/ui API on Firecloud: POST installs an Incendio
// release (the latest by default) into /opt/incus/ui on the member.
var UICmd = func(sh *service.Handler) microTypes.Endpoint {
	return microTypes.Endpoint{
		Name: "ui",
		Path: "ui",

		Post: microTypes.EndpointAction{Handler: uiPost, ProxyTarget: true},
	}
}

func uiPost(s microTypes.State, r *http.Request) microTypes.Response {
	req := types.UIPut{}
	err := json.NewDecoder(r.Body).Decode(&req)
	if err != nil {
		return microTypes.BadRequest(err)
	}

	tag, err := setup.InstallUI(r.Context(), req.Tag)
	if err != nil {
		return microTypes.SmartError(err)
	}

	return microTypes.SyncResponse(true, types.UIPut{Tag: tag})
}
