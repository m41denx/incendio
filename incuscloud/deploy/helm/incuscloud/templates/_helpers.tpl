{{- define "incuscloud.fullname" -}}
{{- if contains .Chart.Name .Release.Name -}}{{ .Release.Name | trunc 50 | trimSuffix "-" }}{{- else -}}{{ printf "%s-%s" .Release.Name .Chart.Name | trunc 50 | trimSuffix "-" }}{{- end -}}
{{- end -}}

{{- define "incuscloud.labels" -}}
app.kubernetes.io/name: {{ .Chart.Name }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
{{- end -}}

{{/* Selector labels for one component: (dict "ctx" $ "component" "hydra") */}}
{{- define "incuscloud.selector" -}}
app.kubernetes.io/name: {{ .ctx.Chart.Name }}
app.kubernetes.io/instance: {{ .ctx.Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{- define "incuscloud.required" -}}
{{- $_ := required "publicHost is required" .Values.publicHost -}}
{{- $_ := required "clusterDomain is required" .Values.clusterDomain -}}
{{- $_ := required "admin.email is required" .Values.admin.email -}}
{{- $_ := required "openfga.clusterUrl is required: OpenFGA's URL as the Incus clusters reach it" .Values.openfga.clusterUrl -}}
{{- if and (not .Values.postgres.enabled) (not .Values.externalDatabase.existingSecret) -}}
{{- fail "postgres.enabled=false needs externalDatabase.existingSecret" -}}
{{- end -}}
{{- end -}}

{{/* The secret with the databases' URLs: the chart's own, or externalDatabase.existingSecret. */}}
{{- define "incuscloud.dbSecret" -}}
{{- if .Values.postgres.enabled -}}{{ include "incuscloud.fullname" . }}{{- else -}}{{ .Values.externalDatabase.existingSecret }}{{- end -}}
{{- end -}}

{{- define "incuscloud.hydraHost" -}}{{ include "incuscloud.fullname" . }}-hydra{{- end -}}
{{- define "incuscloud.openfgaHost" -}}{{ include "incuscloud.fullname" . }}-openfga{{- end -}}
{{- define "incuscloud.postgresHost" -}}{{ include "incuscloud.fullname" . }}-postgres{{- end -}}

{{- define "incuscloud.openfgaEnv" -}}
- { name: OPENFGA_DATASTORE_ENGINE, value: postgres }
- name: OPENFGA_DATASTORE_URI
  valueFrom: { secretKeyRef: { name: {{ include "incuscloud.dbSecret" . }}, key: openfga-uri } }
- { name: OPENFGA_AUTHN_METHOD, value: preshared }
- name: OPENFGA_AUTHN_PRESHARED_KEYS
  valueFrom: { secretKeyRef: { name: {{ include "incuscloud.fullname" . }}, key: openfga-key } }
- { name: OPENFGA_HTTP_ADDR, value: "0.0.0.0:8080" }
- { name: OPENFGA_PLAYGROUND_ENABLED, value: "false" }
- { name: OPENFGA_LOG_LEVEL, value: warn }
{{- end -}}
