terraform {
  required_version = ">= 1.13"

  required_providers {
    # Authenticates with the HCLOUD_TOKEN environment variable.
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = "~> 1.69"
    }
    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.1"
    }
  }
}
