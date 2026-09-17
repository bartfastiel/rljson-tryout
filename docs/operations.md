# Operations: bringing the system down and up

The whole system runs on one Hetzner `cpx32` that costs 0.0569 EUR per hour
plus 0.0008 EUR per hour for its primary IPv4 (about 42 EUR per month,
excluding VAT) whether anybody uses it or not. Two manually triggered
workflows switch it off and on with one click each:

| Workflow                                | What it does                                                                                                       |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| [`Down`](../.github/workflows/down.yml) | Destroys every workloads workspace, then the cluster. Afterwards only the primary IP costs money.                  |
| [`Up`](../.github/workflows/up.yml)     | Applies the cluster, then the production workloads with the image of the current `main` commit, and verifies both. |

Both run only from `main` and both need the same secrets and variables as
the pipeline (`HCLOUD_TOKEN`, `AWS_ROLE_ARN`). They share the concurrency
groups `cluster` and `workloads-production` with the pipeline, so they queue
behind a deployment that is in flight instead of racing it, and a common
group `lifecycle` keeps `Up` and `Down` from ever overlapping each other.

## Bringing the system down

In the GitHub UI: Actions, `Down`, "Run workflow", branch `main`, type
`down` into the confirmation field, "Run workflow". From a shell:

```sh
gh workflow run Down --ref main --field confirmation=down
gh run watch "$(gh run list --workflow Down --limit 1 --json databaseId --jq '.[0].databaseId')"
```

Any other confirmation value fails the run in its first job before anything
is touched.

Expected sequence and durations (measured on the pipeline; the first real
`Down` and `Up` cycle refines them):

| Job         | Step                                                     | Duration                                                           |
| ----------- | -------------------------------------------------------- | ------------------------------------------------------------------ |
| `confirm`   | Checks the input                                         | seconds                                                            |
| `workloads` | Checkout, AWS role, Terraform, `init` of both stages     | about 30 seconds                                                   |
| `workloads` | Probes the Kubernetes API server                         | seconds                                                            |
| `workloads` | `terraform destroy` per workspace, previews first        | about 1 minute for `production` (the namespace deletion dominates) |
| `cluster`   | Checkout, AWS role, Terraform, `init`                    | about 20 seconds                                                   |
| `cluster`   | `terraform destroy`: server, firewall, SSH key, key pair | about 30 seconds                                                   |

A `Down` on a system with production only takes three to four minutes. The
run's summary page lists every workspace with the number of resources it
destroyed and the cluster resources that are gone.

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
gh run watch "$(gh run list --workflow Up --limit 1 --json databaseId --jq '.[0].databaseId')"
```

`Up` deploys the image of the commit it was started from, which is the head
of `main`. The pipeline pushed that image when the commit landed, so start
`Up` only when the last pipeline run on `main` is green; a missing image
fails the workloads job in its first step instead of after a rollout
timeout.

| Job         | Step                                                                         | Duration                                                                 |
| ----------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `cluster`   | Checkout, AWS role, Terraform, `init`                                        | about 20 seconds                                                         |
| `cluster`   | `terraform apply`: key pair, SSH key, firewall, server                       | server created after about 15 seconds                                    |
| `cluster`   | Still `apply`: SSH hand-off waits for cloud-init, k3s and a `Ready` node     | one to three minutes                                                     |
| `cluster`   | Waits for the API server, verifies the kubeconfig with `kubectl`             | about 20 seconds                                                         |
| `workloads` | Checkout, image check, AWS role, Terraform, `init`, workspace `production`   | about 30 seconds                                                         |
| `workloads` | `terraform apply`: namespace, deployment, service, two ingresses             | about 30 seconds, the rollout waits for the image pull and the readiness |
| `workloads` | Polls `/health` on every hostname for the commit, checks the `http` redirect | seconds                                                                  |

An `Up` takes four to six minutes. Preview environments are not recreated;
they come back with the next push to their pull request.

## What survives, what is lost

Survives a `Down`:

- The Terraform state of both stages in the S3 bucket, including the empty
  `production` workspace. Nothing has to be imported or bootstrapped again.
- The primary IP `rljson-tryout` and the two DNS records pointing at it.
  The next server gets the same address, so `Up` needs no DNS change. The
  primary IP is the only Hetzner cost that remains (0.0008 EUR per hour,
  well under one euro per month).
- The container images in GHCR, the repository secrets and variables, the
  AWS role and the bucket.

Lost with a `Down`:

- Everything on the server: the k3s cluster, its certificate authority (the
  kubeconfig changes with every `Up`), all in-cluster data. Today the only
  store is in memory and reseeds itself at start; the persistent stores of
  phase C live on the server's local disk and start empty after an `Up`.
- The generated SSH key pair. `Up` creates a new one.
- Traefik's self-signed default certificate. Once slice A10 issues Let's
  Encrypt certificates, every `Up` requests them again: the limit that
  matters is five duplicate certificates per exact hostname set per week,
  so more than five `Down` and `Up` cycles in a week leave production
  without a valid certificate until the window passes. Test frequent
  cycles against the staging issuer.

## Recovering from trouble

### A stale state lock

Symptom: a Terraform step fails with `Error acquiring the state lock` and
prints a lock ID, although no run is in progress. This happens when a run
was cancelled or the runner died between lock and unlock. Check the
Actions tab first: every `Pipeline`, `Up` and `Down` run must be finished.
Then, from a shell with AWS credentials that may access the bucket, in the
stage directory the error came from:

```sh
cd infra/terraform/workloads   # or infra/terraform/cluster
terraform init -input=false
terraform workspace select production   # workloads only, the workspace named in the error
terraform force-unlock <lock ID from the error>
```

`force-unlock` removes the lock file the S3 backend keeps next to the state
object; the state itself is untouched. Rerun the failed workflow
afterwards.

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
nothing yet; a run cancelled in the middle of an apply or destroy gets an
interrupt that Terraform normally honours by finishing the current resource
and releasing the lock. Start the workflow again; if it reports a stale
lock, see above.
