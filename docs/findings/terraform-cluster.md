# Terraform cluster stage on Hetzner

## What we tried

- Terraform 1.16.2, provider `hetznercloud/hcloud` 1.69.0, `hashicorp/tls`
  4.4.1, state in S3 with `use_lockfile = true`, applied from GitHub Actions
  through an OIDC role (`infra/terraform/cluster`, pull request #5).
- `hcloud_server` with `server_type = "cx32"`, the type named in the plan of
  2026-09-17, image `ubuntu-24.04`, location taken from the pre-created
  primary IP `rljson-tryout` in `nbg1`.
- After the first failure: `data "hcloud_server_type"` for `cx33` and a
  precondition on the server that the type is `available` in the primary
  IP's location (pull request #9, first plan).
- cloud-init with `package_update` only (no upgrade), a `HelmChartConfig`
  for Traefik and the k3s installer from the `stable` channel; the pipeline
  polls `https://<ip>:6443/version` every ten seconds after the apply.
- Slice A7: `ssh_sensitive_resource` of `loafoe/ssh` 2.7.0 with the
  generated ed25519 key, `timeout = "15m"`, `retry_delay = "5s"`, commands
  `cloud-init status --wait`, a loop on `k3s kubectl get nodes` and
  `cat /etc/rancher/k3s/k3s.yaml`; the pipeline writes the output to a file
  with mode 600 and runs `kubectl wait node --all --for=condition=Ready`.

## What happened

- The first apply on `main` (run 35200998944) created `tls_private_key`,
  `hcloud_ssh_key` and `hcloud_firewall` and stopped at the server with
  `Error: server type cx32 not found`. Hetzner introduced `cx22`, `cx32`,
  `cx42`, `cx52` on 2024-06-06 and replaced them by `cx23`, `cx33`, `cx43`,
  `cx53` on 2025-10-16; the old names are gone from the API, and the
  provider's documentation examples now use `cx23`. The same announcement
  retired the AMD line `cpx11` to `cpx51` in `fsn1`, `nbg1`, `hel1` and
  `sin` from 2026-01-01 in favour of `cpx12` to `cpx62`.
- The plan with `cx33` failed its own precondition:
  `Server type cx33 is not available in location nbg1` (the data source
  reported `available = false` for `nbg1`). The cost-optimized line is sold
  out in Nuremberg at the time of writing.
- Prices in `fsn1`, `nbg1` and `hel1` since Hetzner's adjustment of
  2026-06-15, excluding VAT and IPv4: `cx33` 0.0136 EUR per hour (8.49 EUR
  per month), `cax21` 0.0168 EUR per hour, `cpx22` 0.0312 EUR per hour,
  `cpx32` 0.0569 EUR per hour (35.49 EUR per month). The plan of 2026-09-17
  had assumed 0.0113 EUR per hour for `cx32`.
- First boot of the `cpx32` (run 35202364603 on `main`): Hetzner reported
  the server created 11 seconds after the API call, and the Kubernetes API
  server answered on port 6443 with the 401 `Status` body 44 seconds after
  that, so cloud-init, the k3s download and the API server start-up took
  under one minute without a package upgrade. The unauthenticated answer is
  a 401 because k3s starts kube-apiserver with `--anonymous-auth=false`.
- The state file of this stage contains the ed25519 private key of
  `tls_private_key.main` in clear; from slice A7 on it also contains the
  cluster's kubeconfig with the cluster administrator's client certificate
  and key. Everything that can read the bucket can log in to the server as
  root and administer the cluster.
- `loafoe/ssh` retries each command until the resource's `timeout`, which
  covers the window in which the server is up but `sshd` is not yet
  answering. Without the provider argument `debug_log` it prints every
  command's output, including the kubeconfig, to the plugin's standard
  output through `fmt.Printf`; Terraform forwards plugin output to its own
  log when `TF_LOG` is set. The `ssh_resource` variant keeps `result`
  unmarked, so a replacement plan would print the old kubeconfig;
  `ssh_sensitive_resource` marks it sensitive.
- The first run in CI could not assume the AWS role: GitHub issues the
  immutable subject `repo:<owner>@<owner id>/<name>@<repository id>:...`
  for repositories created after 2026-07-15, which the pattern
  `repo:<owner>/<name>:*` in the role's trust policy did not match. The
  repository endpoint `actions/oidc/customization/sub` returns
  `use_immutable_subject: true` together with the `sub_claim_prefix`.

## What it means for rljson users

- Nothing rljson-specific; this file records the infrastructure that the
  later rljson experiments run on.
- Do not hard-code a Hetzner server type in a plan that lives longer than a
  few months. The stage now takes the type from the variable `server_type`
  (default `cpx32`, regular performance, available in `nbg1`), resolves the
  type and the image through data sources, and fails the plan on the pull
  request when the type does not exist or is sold out in the primary IP's
  location. Trying `cx33` again is a one-line pull request: a passing plan
  means it is in stock.
- The state bucket is private (public access blocked, encryption at rest,
  versioning) and readable only by the owner's IAM user and the OIDC role of
  this repository, because the state holds root access to the server and,
  from A7 on, to the cluster.
- A bootstrap script that trusts GitHub OIDC must read the subject prefix
  from the API instead of assuming `repo:<owner>/<name>`.
- Hand the kubeconfig over as a sensitive output and consume it from a file
  with mode 600 that lives only for the verification step; never `echo` it,
  never run Terraform with `TF_LOG` in CI, and set `debug_log = "/dev/null"`
  on the `ssh` provider. That path exists only on Linux and macOS: on
  Windows the provider fails to open it, silently keeps the `fmt.Printf`
  fallback, and a local `terraform apply` with `TF_LOG` set would log the
  kubeconfig; applies run only in CI on Linux, `plan` and `validate` do not
  execute commands.

## Candidates for upstream issues

- `loafoe/terraform-provider-ssh`: `Config.Debug` falls back to
  `fmt.Printf` when `debug_log` is unset, so command output reaches the
  plugin's standard output by default. Reproduce with any `ssh_resource`
  whose last command prints a secret and `TF_LOG=TRACE terraform apply`.
- `hetznercloud/terraform-provider-hcloud`: the "server type not found"
  error could name the successor type or point at the server type list.
  Reproduce with an `hcloud_server` whose `server_type` is `cx32` and
  `terraform apply`.
