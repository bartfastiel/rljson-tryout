# The workspace name selects the environment. `production` deploys the
# namespace `petshop` with the plain hostnames, the apex host, the
# production issuer, the three nodes of the pet shop (node1 and node2
# over the SQLite store on a persistent volume each, so that their data
# survives a redeploy, and node3 over the in-memory store) and the medium
# seed, so that the live nodes hold enough rows to observe rljson at volume.
# `pr-<number>` deploys the preview of that pull request: a namespace of the
# same name, `-pr-<number>` inside every hostname, no apex host,
# certificates from the staging issuer, because Let's Encrypt allows 50 new
# certificates per registered domain per week and previews must never use
# up the budget production needs for its own hosts (see
# docs/findings/tls-cert-manager.md), a single node over the in-memory
# store, because a preview is thrown away with its pull request and needs
# neither a volume nor the network (the three-node behaviour is proven by
# the Docker Compose setup in CI and by production itself), and the small
# seed a reviewer can read through. Any other workspace fails the plan
# through the precondition in main.tf.
locals {
  is_production_workspace = terraform.workspace == "production"
  is_preview_workspace    = can(regex("^pr-[1-9][0-9]*$", terraform.workspace))

  environment = local.is_production_workspace ? {
    name                = "petshop"
    hostname_infix      = ""
    cluster_issuer      = local.cluster_issuer_names.production
    enable_apex_ingress = true
    rljson_domain       = "petshop-production"
    seed_size           = "medium"
    nodes = [
      { name = "node1", storage = "sqlite" },
      { name = "node2", storage = "sqlite" },
      { name = "node3", storage = "memory" },
    ]
    } : {
    name                = terraform.workspace
    hostname_infix      = "-${terraform.workspace}"
    cluster_issuer      = local.cluster_issuer_names.staging
    enable_apex_ingress = false
    rljson_domain       = "petshop-${terraform.workspace}"
    seed_size           = "small"
    nodes = [
      { name = "node1", storage = "memory" },
    ]
  }
}

# The dependency serializes the environment behind the issuers in both
# directions: on destroy, the ingresses and any open ACME challenge go before
# cert-manager, so no finalizer is left without its controller.
module "environment" {
  source = "./modules/petshop-environment"

  environment_name    = local.environment.name
  image               = var.image
  base_domain         = var.base_domain
  hostname_infix      = local.environment.hostname_infix
  cluster_issuer      = local.environment.cluster_issuer
  enable_apex_ingress = local.environment.enable_apex_ingress
  rljson_domain       = local.environment.rljson_domain
  seed_size           = local.environment.seed_size
  nodes               = local.environment.nodes

  depends_on = [kubectl_manifest.cluster_issuer]
}
