# Event Management Website - CI/CD with Jenkins + Kubernetes (Minikube)

Events: **Nescon, Execup, VisioSpark, ACM Hackathon** (seeded automatically; you can add more from the website).

```
Browser --> Frontend (nginx, NodePort 30080) --> Backend (Node.js/Express) --> PostgreSQL (PVC)
                                                      |
                                                  /metrics --> Prometheus --> Grafana
```

```
event-management-cicd/
├── Jenkinsfile                  # the pipeline
├── backend/                     # Tier 2: API (Node.js) + Dockerfile
├── frontend/                    # Tier 1: website (HTML + nginx) + Dockerfile
├── k8s/                         # Tier 3 + Kubernetes manifests (DB, backend, frontend)
└── monitoring/                  # Prometheus + Grafana install (do later)
```

---

## STEP 1 - Prepare the server (one time)

Jenkins is already installed. It must be able to run `docker`, `minikube` and `kubectl`.

```bash
# 1. Install Docker, kubectl, minikube if you do not have them
#    (docker: https://docs.docker.com/engine/install/ , minikube: https://minikube.sigs.k8s.io/docs/start/)

# 2. Let the jenkins user use docker
sudo usermod -aG docker jenkins

# 3. Start minikube AS the jenkins user (so Jenkins sees the same cluster)
sudo su - jenkins
minikube start --driver=docker --cpus=2 --memory=4096
kubectl get nodes          # should show minikube Ready
exit

# 4. Restart Jenkins so the docker group takes effect
sudo systemctl restart jenkins
```

If you want to run `kubectl` as your own user too, run `minikube start` as that user as well.
To use only one user for everything, start minikube as `jenkins` and use `sudo su - jenkins` whenever you need kubectl.

## STEP 2 - Push the project to GitHub

```bash
cd event-management-cicd
git init
git add .
git commit -m "Event management 3-tier app with Jenkins pipeline"
git branch -M main
git remote add origin https://github.com/<your-username>/event-management-cicd.git
git push -u origin main
```

## STEP 3 - Create the Jenkins pipeline job

1. Jenkins -> **New Item** -> name `event-management` -> **Pipeline** -> OK
2. Under **Pipeline**: Definition = **Pipeline script from SCM**
3. SCM = **Git**, Repository URL = your GitHub repo URL, Branch = `*/main`
4. Script Path = `Jenkinsfile`
5. (Optional) Build Triggers -> **Poll SCM** -> `H/2 * * * *` (checks GitHub every 2 minutes)
6. Save -> **Build Now**

Pipeline stages: Checkout -> Build Images -> Test -> Load Images into Minikube -> Deploy to Kubernetes -> Verify Rollout.
If a build fails, the `post` section automatically rolls back backend and frontend.

## STEP 4 - Open the website

```bash
minikube service frontend -n event-app --url
```

Open the URL in your browser. Useful checks:

```bash
kubectl -n event-app get pods
kubectl -n event-app logs deploy/backend
```

If you open it from another computer, use `minikube ip` + port `30080`
(with the docker driver you may need `kubectl -n event-app port-forward --address 0.0.0.0 svc/frontend 8080:80`).

## STEP 5 - Maintain (the CI/CD loop)

Edit any file (for example `frontend/index.html`) -> `git commit` -> `git push` -> Jenkins builds a new image
tagged with the build number, deploys it with a rolling update, and the site updates with no downtime.

Handy commands:

```bash
kubectl -n event-app rollout history deployment/backend
kubectl -n event-app rollout undo deployment/backend        # manual rollback
kubectl -n event-app scale deployment/frontend --replicas=3 # scale
```

## STEP 6 - Monitoring (when you are ready)

```bash
cd monitoring
chmod +x install-monitoring.sh
./install-monitoring.sh
```

This installs Prometheus + Grafana (via Helm) and makes Prometheus scrape the backend `/metrics` endpoint.
Grafana login: `admin` / `admin123` (change it). In Grafana open the built-in **Kubernetes / Compute Resources**
dashboards for pod CPU and memory. To chart the app itself, query `http_requests_total` in Explore.

Minikube needs about 4 GB RAM for monitoring; if it is slow, start with `minikube start --memory=6144`.

## Troubleshooting

| Problem | Fix |
|---|---|
| `permission denied` on docker in Jenkins | `sudo usermod -aG docker jenkins` then restart Jenkins |
| `kubectl: command not found` in Jenkins | install kubectl system-wide (`/usr/local/bin`) |
| `minikube: command not found` / cluster not found | start minikube as the `jenkins` user (Step 1) |
| Pods `ImagePullBackOff` | the `minikube image load` stage did not run; check build log |
| Backend `CrashLoopBackOff` | `kubectl -n event-app logs deploy/backend` (usually DB still starting; it retries ~90 s) |

## Notes

- DB credentials are in `k8s/01-database.yaml` (demo values). Change them for real use.
- Database data lives on a PersistentVolume, so it survives pod restarts.
