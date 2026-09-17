# The workspace name selects the environment. `production` deploys the
# namespace `petshop` with the plain hostnames, the apex host and the
# production issuer. `pr-<number>` deploys the preview of that pull request:
# a namespace of the same name, `-pr-<number>` inside every hostname, no apex
# host, and certificates from the staging issuer, because Let's Encrypt
# allows 50 new certificates per registered domain per week and previews
# must never use up the budget production needs for its own hosts (see
# docs/findings/tls-cert-manager.md). Any other workspace fails the plan
# through the precondition in main.tf.
locals {
  is_production_workspace = terraform.workspace == "production"
  is_preview_workspace    = can(regex("^pr-[1-9][0-9]*$", terraform.workspace))

  environment = local.is_production_workspace ? {
    name                = "petshop"
    hostname_infix      = ""
    cluster_issuer      = local.cluster_issuer_names.production
    enable_apex_ingress = true
    } : {
    name                = terraform.workspace
    hostname_infix      = "-${terraform.workspace}"
    cluster_issuer      = local.cluster_issuer_names.staging
    enable_apex_ingress = false
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
  nodes = [
    { name = "node1" },
  ]

  depends_on = [kubectl_manifest.cluster_issuer]
}
