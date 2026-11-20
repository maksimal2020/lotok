{{- define "lotok.labels" -}}
app.kubernetes.io/part-of: lotok
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{- end -}}

{{- define "lotok.image" -}}
{{ .root.Values.image.registry }}/{{ .name }}:{{ .root.Values.image.tag }}
{{- end -}}

{{- define "lotok.apiEnv" -}}
envFrom:
  - configMapRef: { name: lotok-config }
  - secretRef: { name: {{ .Values.existingSecret }} }
{{- end -}}

{{/* Секрет для приватного реестра образов (например, ghcr.io). */}}
{{- define "lotok.imagePullSecrets" -}}
{{- with .Values.image.pullSecrets -}}
imagePullSecrets:
{{- range . }}
  - name: {{ . }}
{{- end }}
{{- end }}
{{- end -}}
