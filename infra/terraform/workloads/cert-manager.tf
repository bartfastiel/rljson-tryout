# cert-manager and the ClusterIssuers exist once per cluster; the production
# workspace owns them and every other workspace only refers to them by name.
locals {
  manages_cluster_services = local.is_production_workspace
  acme_servers = {
    staging    = "https://acme-staging-v02.api.letsencrypt.org/directory"
    production = "https://acme-v02.api.letsencrypt.org/directory"
  }
  cluster_issuer_names = { for name, server in local.acme_servers : name => "letsencrypt-${name}" }
}

resource "helm_release" "cert_manager" {
  count = local.manages_cluster_services ? 1 : 0

  name             = "cert-manager"
  repository       = "https://charts.jetstack.io"
  chart            = "cert-manager"
  version          = "v1.21.2"
  namespace        = "cert-manager"
  create_namespace = true
  wait             = true

  set = [
    {
      name  = "crds.enabled"
      value = "true"
    },
  ]
}

resource "kubectl_manifest" "cluster_issuer" {
  for_each = local.manages_cluster_services ? local.acme_servers : {}

  yaml_body = yamlencode({
    apiVersion = "cert-manager.io/v1"
    kind       = "ClusterIssuer"
    metadata = {
      name = local.cluster_issuer_names[each.key]
    }
    spec = {
      acme = {
        server = each.value
        email  = var.letsencrypt_email
        privateKeySecretRef = {
          name = "${local.cluster_issuer_names[each.key]}-account-key"
        }
        solvers = [{
          http01 = {
            ingress = {
              ingressClassName = "traefik"
            }
          }
        }]
      }
    }
  })
  sensitive_fields  = ["spec.acme.email"]
  server_side_apply = true

  wait_for {
    condition {
      type   = "Ready"
      status = "True"
    }
  }

  depends_on = [helm_release.cert_manager]
}
