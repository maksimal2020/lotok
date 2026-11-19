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
