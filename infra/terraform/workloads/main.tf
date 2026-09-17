data "terraform_remote_state" "cluster" {
  backend = "s3"

  config = {
    bucket = "bartfastiel-rljson-tryout-tfstate"
    key    = "cluster/terraform.tfstate"
    region = "eu-central-1"
  }
}

# The remote state data source hands the cluster's outputs over without the
# sensitive flag they carry in the cluster stage, so it is restored here
# before anything is derived from the kubeconfig.
locals {
  kubeconfig         = yamldecode(sensitive(data.terraform_remote_state.cluster.outputs.kubeconfig))
  kubeconfig_cluster = local.kubeconfig.clusters[0].cluster
  kubeconfig_user    = local.kubeconfig.users[0].user
}

provider "kubernetes" {
  host                   = local.kubeconfig_cluster.server
  cluster_ca_certificate = base64decode(local.kubeconfig_cluster["certificate-authority-data"])
  client_certificate     = base64decode(local.kubeconfig_user["client-certificate-data"])
  client_key             = base64decode(local.kubeconfig_user["client-key-data"])
}

module "production" {
  source = "./modules/petshop-environment"

  environment_name = "petshop"
  image            = "${var.image_repository}:${var.image_tag}"
  base_domain      = var.base_domain
  hostname_infix   = ""
  nodes = [
    { name = "node1", storage = "memory" },
  ]
}
