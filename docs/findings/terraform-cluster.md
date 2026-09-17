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
- The state file of this stage contains the ed25519 private key of
  `tls_private_key.main` in clear; from slice A7 on it also contains the
  cluster's kubeconfig. Everything that can read the bucket can log in to
  the server as root and administer the cluster.
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

## Candidates for upstream issues

- `hetznercloud/terraform-provider-hcloud`: the "server type not found"
  error could name the successor type or point at the server type list.
  Reproduce with an `hcloud_server` whose `server_type` is `cx32` and
  `terraform apply`.
