#!/usr/bin/env bash
# Installs Prometheus + Grafana (kube-prometheus-stack) on minikube.
# Run this ONCE, manually, after the app is deployed. Needs: helm, kubectl.
set -e

if ! command -v helm >/dev/null 2>&1; then
  echo "Installing helm..."
  curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
fi

helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update

helm upgrade --install monitoring prometheus-community/kube-prometheus-stack \
  --namespace monitoring --create-namespace \
  --set grafana.adminPassword=admin123 \
  --set grafana.service.type=NodePort \
  --set grafana.service.nodePort=32000 \
  --set prometheus.service.type=NodePort \
  --set prometheus.service.nodePort=32001 \
  --set prometheus.prometheusSpec.serviceMonitorSelectorNilUsesHelmValues=false \
  --wait --timeout 10m

# Tell Prometheus to scrape the backend /metrics endpoint
kubectl apply -f "$(dirname "$0")/backend-servicemonitor.yaml"

echo
echo "Grafana    : $(minikube service monitoring-grafana -n monitoring --url | head -1)   (admin / admin123)"
echo "Prometheus : $(minikube service monitoring-kube-prometheus-prometheus -n monitoring --url | head -1)"
