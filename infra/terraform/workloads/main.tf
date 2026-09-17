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
  kubeconfig             = yamldecode(sensitive(data.terraform_remote_state.cluster.outputs.kubeconfig))
  kubeconfig_cluster     = local.kubeconfig.clusters[0].cluster
  kubeconfig_user        = local.kubeconfig.users[0].user
  api_server_host        = local.kubeconfig_cluster.server
  cluster_ca_certificate = base64decode(local.kubeconfig_cluster["certificate-authority-data"])
  client_certificate     = base64decode(local.kubeconfig_user["client-certificate-data"])
  client_key             = base64decode(local.kubeconfig_user["client-key-data"])
}

provider "kubernetes" {
  host                   = local.api_server_host
  cluster_ca_certificate = local.cluster_ca_certificate
  client_certificate     = local.client_certificate
  client_key             = local.client_key
}

provider "helm" {
  kubernetes = {
    host                   = local.api_server_host
    cluster_ca_certificate = local.cluster_ca_certificate
    client_certificate     = local.client_certificate
    client_key             = local.client_key
  }
}

# The retries cover the seconds between cert-manager's pods becoming ready
# and its webhook accepting requests.
provider "kubectl" {
  host                   = local.api_server_host
  cluster_ca_certificate = local.cluster_ca_certificate
  client_certificate     = local.client_certificate
  client_key             = local.client_key
  load_config_file       = false
  apply_retry_count      = 15
}

module "production" {
  source = "./modules/petshop-environment"

  environment_name = "petshop"
  image            = "${var.image_repository}:${var.image_tag}"
  base_domain      = var.base_domain
  hostname_infix   = ""
  cluster_issuer   = local.cluster_issuer_names.staging
  nodes = [
    { name = "node1" },
  ]
}
