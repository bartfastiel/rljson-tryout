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
    ssh = {
      source  = "loafoe/ssh"
      version = "~> 2.7"
    }
  }
}

# Without a debug log file the provider prints every command's output,
# including the kubeconfig, to the plugin's standard output, which Terraform
# forwards to its own log when TF_LOG is set.
provider "ssh" {
  debug_log = "/dev/null"
}
