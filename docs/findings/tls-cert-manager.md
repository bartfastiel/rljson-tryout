# TLS with cert-manager on k3s

## What we tried

- Slice A10 in `infra/terraform/workloads`: provider `hashicorp/helm` 3.3.0
  (constraint `~> 3.0`) configured through its `kubernetes = { ... }`
  attribute from the same kubeconfig values as the kubernetes provider,
  `helm_release` of the cert-manager chart `v1.21.2` from
  `https://charts.jetstack.io` with `crds.enabled = true`, namespace
  `cert-manager`, `wait = true`.
- Two `ClusterIssuer`s `letsencrypt-staging` and `letsencrypt-production`
  (ACME HTTP-01, `ingressClassName: traefik`, email from the sensitive
  variable `letsencrypt_email`), first as `kubernetes_manifest` with
  `depends_on` on the Helm release, then as `kubectl_manifest` of
  `alekc/kubectl` 2.4.1 with `server_side_apply`, `sensitive_fields =
["spec.acme.email"]` and a `wait_for` on the `Ready` condition.
- cert-manager and the issuers are guarded with `count` and `for_each` on
  `terraform.workspace == "production"`, so a later preview workspace only
  refers to the issuers by name.
- The module puts `cert-manager.io/cluster-issuer` and a `tls` block with
  one secret per host (`node1-tls`, `apex-tls`) on every ingress; the root
  module names `letsencrypt-staging` first and switches to
  `letsencrypt-production` in a second pull request after the staging
  certificate has been seen on the live cluster.
- The verification step of the pipeline reads the served certificate's
  issuer with `openssl s_client ... | openssl x509 -noout -issuer` and
  waits until it contains `Let's Encrypt`.

## What happened

- `kubernetes_manifest` refuses to plan before the custom resource
  definition exists, even with `depends_on` on the Helm release:
  `Error: API did not recognize GroupVersionKind from manifest (CRD may be
not installed)`, `no matches for kind "ClusterIssuer" in group
"cert-manager.io"`. The provider fetches the OpenAPI schema of the kind at
  plan time, so the first pull request of this slice could never have shown
  a green plan; `alekc/kubectl` only parses the YAML at plan time and
  planned `3 to add, 2 to change` (Helm release, two issuers, two ingress
  updates) against the cluster without cert-manager.
- `alekc/kubectl` 3.0.0 is still in beta (`3.0.0-beta3`, 2026-07-01), so
  the stable 2.4.1 of 2026-06-01 is pinned with `~> 2.4`.
- The kubectl provider marks `yaml_body` sensitive on its own and shows an
  obfuscated `yaml_body_parsed` instead; with `sensitive_fields` the plan
  prints `email: (sensitive value)` inside it, and the sensitive Terraform
  variable keeps the address out of every other plan line as well.
- Before cert-manager existed, `openssl x509 -noout -issuer` on the served
  certificate returned `issuer=CN=TRAEFIK DEFAULT CERT`. The staging
  certificates read `issuer=C = US, O = Let's Encrypt, CN = (STAGING)
Ersatz Emmer YR2` on the runner (OpenSSL 3.0 prints spaces around the
  `=`, the local OpenSSL 3.2 does not), the production ones name a `CN`
  without the `(STAGING)` prefix. Both contain `Let's Encrypt`, so one
  check covers both pull requests of the slice.
- First apply on `main` (run 35212430213): the Helm release took 51 s
  including the CRDs and the three deployments, both ClusterIssuers were
  `Ready` 2 s after creation, and the ingress shim had the staging
  certificate for `node1` issued 46 s after the issuers appeared (`Order`
  `valid`, `Certificate` `READY True`, no `Challenge` left behind); the apex
  certificate followed within the same minute. The ingress update itself
  was instantaneous, the deployment rollout to the new image tag 17 s.
- The apply did not need the retries on the kubectl provider: the webhook
  answered the first ClusterIssuer request 1 s after Helm reported the
  release ready.
- Traefik's permanent redirect from `web` to `websecure` does not block
  HTTP-01: Let's Encrypt follows redirects to `https://` and does not
  validate the certificate it meets there, and the solver ingress created
  by cert-manager is attached to both entrypoints like every other ingress.
  cert-manager's own pre-flight self-check behaves the same way, it follows
  the redirect with certificate verification disabled, and the hairpin from
  a pod through the public IP back into Traefik works on this k3s (the
  review of pull request #16 verified both from inside the cluster).
- A `terraform destroy` of the workloads leaves the namespace
  `cert-manager`, the custom resource definitions (`crds.keep` defaults to
  `true` in the chart) and the two ACME account key secrets in the cluster.
  Helm adopts the kept definitions on the next install because release
  name and namespace are unchanged, so a re-apply needs no manual cleanup,
  and the reused account keys mean no new ACME registration. The module
  depends on the issuers, so a destroy removes the ingresses and any open
  challenge before cert-manager and its finalizers are gone.

## What it means for rljson users

- Nothing rljson-specific; the nodes now speak HTTPS with certificates a
  browser trusts, which the web app and the later cross-node links rely on.
- Plan a Terraform stage that installs an operator and its custom resources
  in one go around `kubernetes_manifest`'s plan-time schema lookup: either a
  provider that applies raw YAML, or two stages.
- Let's Encrypt production issues at most five identical certificates per
  week per host set; prove a new setup against the staging issuer first.

## Candidates for upstream issues

- `hashicorp/terraform-provider-kubernetes`: `kubernetes_manifest` could
  defer the schema lookup to apply time when the kind is unknown and the
  resource has `depends_on`. Reproduce: a `helm_release` that installs a CRD
  and a `kubernetes_manifest` of that kind with `depends_on` on the release,
  `terraform plan` on an empty cluster.
