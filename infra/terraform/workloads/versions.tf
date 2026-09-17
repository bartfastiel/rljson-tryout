terraform {
  required_version = ">= 1.13"

  required_providers {
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 3.0"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 3.0"
    }
    # Applies the ClusterIssuers, whose kind the kubernetes provider cannot
    # plan before cert-manager has installed its custom resource definitions.
    kubectl = {
      source  = "alekc/kubectl"
      version = "~> 2.4"
    }
  }
}
