# Operations: bringing the system down and up

The whole system runs on one Hetzner `cpx32`. Hetzner bills it by the hour
(0.0569 EUR) and caps the month at the monthly price, 35.49 EUR, plus about
0.50 EUR for the primary IPv4, excluding VAT, whether anybody uses it or
not. Two manually triggered workflows switch it off and on with one click
each:

| Workflow                                | What it does                                                                                                       |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| [`Down`](../.github/workflows/down.yml) | Destroys every workloads workspace, then the cluster. Afterwards only the primary IP costs money.                  |
| [`Up`](../.github/workflows/up.yml)     | Applies the cluster, then the production workloads with the image of the current `main` commit, and verifies both. |

Both run only from `main` and both need the same secrets and variables as
the pipeline (secrets `HCLOUD_TOKEN` and `LETSENCRYPT_EMAIL`, variable
`AWS_ROLE_ARN`). They share the concurrency groups `cluster` and
`workloads-production` with the pipeline, so they queue behind a deployment
that is in flight instead of racing it, and a common group `lifecycle` keeps
`Up` and `Down` from ever overlapping each other. The verification steps
are the pipeline's own, shared through `infra/scripts/`.

Two things to keep in mind while the system is down:

- Any push to `main` runs the pipeline, which applies the cluster and the
  workloads. Merging a pull request is an implicit `Up`; the server then
  runs until the next `Down`.
- `Up` deploys the commit it was started from (`github.sha` is fixed at
  dispatch). Do not merge while `Up` runs: if the pipeline's apply takes the
  `workloads-production` group first, `Up` afterwards rolls production back
  to its own, older commit and its verification still passes.

## Bringing the system down

In the GitHub UI: Actions, `Down`, "Run workflow", branch `main`, type
`down` into the confirmation field, "Run workflow". From a shell:

```sh
gh workflow run Down --ref main --field confirmation=down
sleep 5   # the new run appears in the list with a short delay
gh run watch "$(gh run list --workflow Down --limit 1 --json databaseId --jq '.[0].databaseId')"
```

The first job `confirm` fails within seconds, before any concurrency group
is taken or anything is checked out, when the run was started from another
branch or with any confirmation other than `down`.

Expected sequence and durations (measured on the pipeline; the first real
`Down` and `Up` cycle refines them):

| Job         | Step                                                     | Duration                                                                                                      |
| ----------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `confirm`   | Checks the branch and the input                          | seconds                                                                                                       |
| `workloads` | Checkout, AWS role, Terraform, `init` of both stages     | about 30 seconds                                                                                              |
| `workloads` | Probes the Kubernetes API server                         | seconds                                                                                                       |
| `workloads` | `terraform destroy` per workspace, previews first        | one to two minutes for `production` (eight resources; the Helm uninstall and the namespace deletion dominate) |
| `cluster`   | Checkout, AWS role, Terraform, `init`                    | about 20 seconds                                                                                              |
| `cluster`   | `terraform destroy`: server, firewall, SSH key, key pair | about 30 seconds                                                                                              |

A `Down` on a system with production only takes four to five minutes. The
run's summary page lists every workspace with the number of resources it
destroyed and the cluster resources that are gone; when a workspace fails,
the summary names it and the workspaces that were not touched.

`Down` iterates over every workspace of the workloads stage except
`default`: `pr-*` previews first, `production` last. Preview workspaces are
deleted after their destroy; `production` is kept as an empty workspace so
that the next apply reuses it. The workloads always go first because the
workloads stage reads the cluster's kubeconfig from the cluster state and
cannot even plan once that output is gone (see
[kubernetes-workloads.md](findings/kubernetes-workloads.md)).

When the cluster is already unreachable, that is when the cluster state
has no `kubeconfig` output or the API server behind it does not answer three
probes in a row, `Down` treats every workloads workspace as orphaned: it
deletes the state with `terraform workspace delete -force` instead of
destroying resources that no longer exist, `production` included, and then
destroys whatever the cluster stage still has. `terraform workspace select
-or-create production` recreates the workspace on the next `Up`.

The cluster is destroyed even when the workloads destroy failed, so that a
stuck namespace never keeps the server running. What the workloads state
still lists dies with the server; the next `Up` (refresh finds nothing and
recreates everything) or the next `Down` (orphan handling) reconciles it.

## Bringing the system up

In the GitHub UI: Actions, `Up`, "Run workflow", branch `main`, "Run
workflow". From a shell:

```sh
gh workflow run Up --ref main
sleep 5   # the new run appears in the list with a short delay
gh run watch "$(gh run list --workflow Up --limit 1 --json databaseId --jq '.[0].databaseId')"
```

`Up` deploys the image of the commit it was started from, the head of
`main` at that moment. The pipeline pushed that image when the commit
landed, so start `Up` only when the last pipeline run on `main` is green.
The first job `preflight` fails within seconds, before any server exists,
when the run was started from another branch or the image is missing.

| Job         | Step                                                                                    | Duration                                                               |
| ----------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `preflight` | Checks the branch and that the image of the commit exists in GHCR                       | seconds                                                                |
| `cluster`   | Checkout, AWS role, Terraform, `init`                                                   | about 20 seconds                                                       |
| `cluster`   | `terraform apply`: key pair, SSH key, firewall, server                                  | server created after about 15 seconds                                  |
| `cluster`   | Still `apply`: SSH hand-off waits for cloud-init, k3s and a `Ready` node                | one to three minutes                                                   |
| `cluster`   | Waits for the API server, verifies the kubeconfig with `kubectl`                        | about 20 seconds                                                       |
| `workloads` | Checkout, AWS role, Terraform, `init`, workspace `production`                           | about 30 seconds                                                       |
| `workloads` | `terraform apply`: cert-manager, issuers, namespace, deployment, service, ingresses     | one to two minutes, the rollout waits for the image pull and readiness |
| `workloads` | Polls `/health` for the commit, waits for the Let's Encrypt issuer, checks the redirect | up to two minutes, the certificate is ordered when the ingress appears |

An `Up` takes five to eight minutes. Preview environments are not
recreated; they come back with the next push to their pull request.
Running `Up` while the system is already up is harmless: both stages plan
no changes, or a rolling update to the head of `main` if it moved.

## What survives, what is lost

Survives a `Down`:

- The Terraform state of both stages in the S3 bucket, including the empty
  `production` workspace. Nothing has to be imported or bootstrapped again.
- The primary IP `rljson-tryout` and the two DNS records pointing at it.
  The next server gets the same address, so `Up` needs no DNS change. The
  primary IP is the only Hetzner cost that remains (about 0.50 EUR per
  month).
- The container images in GHCR, the repository secrets and variables, the
  AWS role and the bucket.

Lost with a `Down`:

- Everything on the server: the k3s cluster, its certificate authority (the
  kubeconfig changes with every `Up`), all in-cluster data. Today the only
  store is in memory and reseeds itself at start; the persistent stores of
  phase C live on the server's local disk and start empty after an `Up`.
- The generated SSH key pair. `Up` creates a new one.
- The Let's Encrypt account and certificates of cert-manager. Every `Up`
  registers a new account and orders the certificates again. The limit
  that matters is five duplicate certificates per exact hostname set per
  week on the production issuer, so more than five `Down` and `Up` cycles in
  a week leave production without a valid certificate until the window
  passes. The `letsencrypt-staging` issuer stays installed with far higher
  limits; point the ingresses at it for experiments with frequent cycles.

## Recovering from trouble

### A stale state lock

Symptom: a Terraform step fails with `Error acquiring the state lock` and
prints a lock ID, although no run is in progress. This is the expected
outcome of a run cancelled in the middle of an apply or destroy: the runner
sends the step an interrupt, a termination signal 7.5 seconds later and
then kills it, which is far shorter than the SSH hand-off of the cluster
stage (up to fifteen minutes) or a namespace deletion. Check the Actions
tab first: every `Pipeline`, `Up` and `Down` run must be finished. Then,
from a shell with AWS credentials that may access the bucket, in the stage
directory the error came from:

```sh
cd infra/terraform/workloads   # or infra/terraform/cluster
terraform init -input=false
terraform workspace select production   # workloads only, the workspace named in the error
terraform force-unlock <lock ID from the error>
```

`force-unlock` removes the lock file the S3 backend keeps next to the state
object; the state itself is untouched. Rerun the failed workflow
afterwards. A cancelled cluster apply may also have left the server half
provisioned; the next `Up` or `Down` reconciles it from the state, unless
the kill came between the Hetzner API call and the state write: then a
server named `rljson-tryout` exists that no state knows, and the next `Up`
fails with a name clash. Delete that server in the Hetzner Cloud console
(the primary IP stays, its auto delete is off) and start `Up` again.

### The cluster was destroyed outside Terraform

If the server was deleted in the Hetzner console, either workflow recovers:

- `Down` notices that the API server does not answer, removes the orphaned
  workloads state and destroys what the cluster stage still owns
  (firewall, SSH key). Follow it with `Up` when the system should come
  back.
- `Up` alone works too: the cluster plan refreshes, finds the server gone,
  creates a new one with the same primary IP and hands a new kubeconfig
  over; the workloads plan then gets 404 for every resource, drops them
  from state and creates everything again.

### `Up` fails with "already exists" in the workloads stage

The workloads state was removed while the cluster kept running, for
example by an orphan-handling `Down` whose cluster job failed afterwards.
Run `Down` (it destroys the cluster and with it the unmanaged resources),
then `Up`.

### `Up` or `Down` was cancelled by a newer run

GitHub keeps at most one pending run per concurrency group and cancels the
older pending one when another arrives. A run cancelled while pending did
nothing yet and can simply be started again. A run cancelled while a
Terraform step was in progress usually leaves a stale lock; see above.
