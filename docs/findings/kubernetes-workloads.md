# Kubernetes workloads stage

## What we tried

- Terraform 1.16.2 with provider `hashicorp/kubernetes` 3.2.1 (constraint
  `~> 3.0`) in `infra/terraform/workloads`, state in the same S3 bucket as
  the cluster stage under `env:/production/workloads/terraform.tfstate`
  (slice A9, pull request #14). The cluster runs k3s v1.36.4+k3s1 with the
  IngressClass `traefik` marked as default and Traefik's `LoadBalancer`
  service bound to ports 80 and 443 of the primary IP by k3s's ServiceLB.
- The provider is configured from the cluster stage's sensitive output
  `kubeconfig`, read through `data "terraform_remote_state"` and split with
  `yamldecode` into `server`, `certificate-authority-data`,
  `client-certificate-data` and `client-key-data`, each `base64decode`d.
- Module `petshop-environment` with `kubernetes_namespace_v1`, one
  `kubernetes_deployment_v1` per node (one replica, readiness and liveness
  probes on `/health`, requests `100m`/`128Mi`, limits `500m`/`512Mi`),
  `kubernetes_service_v1` (`ClusterIP` 80 to 8080) and `kubernetes_ingress_v1`
  with `ingress_class_name = "traefik"` per node, plus one ingress for the
  apex host. The pod runs with `run_as_non_root`, `run_as_user = 1000`,
  `run_as_group = 1000`, seccomp `RuntimeDefault`, no privilege escalation
  and all capabilities dropped.
- `terraform plan` locally with the owner's AWS credentials, then
  `terraform show -json` on a saved plan to see whether the remote state
  outputs carry the sensitive flag (the plan file was deleted afterwards
  because it contains the kubeconfig).
- `curl` against `http://node1.rljson-tryout.wer-ist-daniel-schwarz.de/health`
  and the `https://` variant before any ingress existed, to see what the
  bundled Traefik does on its own.
- `docker run --rm --entrypoint id <image>` to learn which numeric user the
  node service image runs as.

## What happened

- The registry offers the 3.x line since 2025-12-03. Version 3.0.0 only
  deprecates the unversioned resources (`kubernetes_deployment`,
  `kubernetes_ingress`, ...) in favour of the `_v1` names and bumps the
  Kubernetes libraries to 1.33; the `_v1` resources keep the 2.x syntax, so
  nothing had to be written differently for the new major. Version 3.2.1
  fixes an `Unexpected Identity Change` error after long readiness waits,
  which matters here because `kubernetes_deployment_v1` waits for the
  rollout by default.
- `terraform_remote_state` drops the sensitive flag: the plan JSON shows
  `sensitive_values.outputs = {}` although `kubeconfig` and
  `ssh_private_key` are sensitive outputs of the cluster stage. Wrapping the
  value in `sensitive()` before `yamldecode` restores it for everything
  derived from it (`issensitive(local.kubeconfig_cluster.server)` is `true`).
- `terraform workspace select -or-create production` against the S3 backend
  immediately writes an empty state object of 181 bytes to
  `env:/production/workloads/terraform.tfstate`; the workspace therefore
  exists in the bucket before the first apply.
- Before any ingress existed, Traefik already answered
  `http://node1.rljson-tryout.wer-ist-daniel-schwarz.de/health` with a
  permanent redirect to `https://` (308 for `HEAD`, 301 for `GET`) because
  the redirect lives on the `web` entrypoint, and `https://` answered 404
  with Traefik's self-signed default certificate. An ingress without a `tls`
  section is attached to both entrypoints, so it becomes reachable on
  `https://` as soon as it exists and `http://` keeps redirecting; a plain
  HTTP service without redirect is not possible with this Traefik
  configuration.
- The node service image declares `USER node` by name. The kubelet enforces
  `runAsNonRoot` only against a numeric user and refuses to start a
  container whose image names a non-numeric user without `runAsUser`, so
  the pod names the ids explicitly; `id` inside the image reports
  `uid=1000(node) gid=1000(node)`.
- The plan for the first production apply is `5 to add`: namespace,
  deployment, service, node ingress and apex ingress. The service resource
  plans `wait_for_load_balancer = true` even for `ClusterIP`; the provider
  ignores it for that type.

## What it means for rljson users

- Nothing rljson-specific; this stage is where the later multi-node
  experiments run. A node is one `Deployment` with one replica because the
  in-memory store lives in the process; the persistent stores of phase C
  get a `StatefulSet` with a volume instead.
- The module only sets the environment variables the service reads today
  (`NODE_NAME`, `LOG_LEVEL`); `RLJSON_DOMAIN`, `STORAGE` and `SEED_SIZE`
  join when the slices that read them land, so a running pod's environment
  always mirrors the configuration module of the service.
- Treat everything derived from a remote state output as sensitive by hand;
  Terraform does not do it for you.

## Candidates for upstream issues

- `hashicorp/terraform`: `terraform_remote_state` does not propagate the
  sensitive flag of the source outputs. Reproduce: mark an output
  `sensitive = true` in one configuration, read it through
  `data "terraform_remote_state"` in another, save a plan and check
  `sensitive_values.outputs` in `terraform show -json`.
