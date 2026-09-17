locals {
  project_name = "rljson-tryout"
  labels = {
    project = local.project_name
  }
}

# Created once by hand and never managed here, so that the address and the
# DNS records pointing at it survive a replacement of the server.
data "hcloud_primary_ip" "main" {
  name = local.project_name
}

resource "tls_private_key" "main" {
  algorithm = "ED25519"
}

resource "hcloud_ssh_key" "main" {
  name       = local.project_name
  public_key = tls_private_key.main.public_key_openssh
  labels     = local.labels
}

resource "hcloud_firewall" "main" {
  name   = local.project_name
  labels = local.labels

  rule {
    description = "ICMP"
    direction   = "in"
    protocol    = "icmp"
    source_ips  = ["0.0.0.0/0", "::/0"]
  }

  dynamic "rule" {
    for_each = {
      "SSH"                   = "22"
      "HTTP"                  = "80"
      "HTTPS"                 = "443"
      "Kubernetes API server" = "6443"
    }
    content {
      description = rule.key
      direction   = "in"
      protocol    = "tcp"
      port        = rule.value
      source_ips  = ["0.0.0.0/0", "::/0"]
    }
  }
}

resource "hcloud_server" "main" {
  name         = local.project_name
  server_type  = "cx32"
  image        = "ubuntu-24.04"
  location     = data.hcloud_primary_ip.main.location
  ssh_keys     = [hcloud_ssh_key.main.id]
  firewall_ids = [hcloud_firewall.main.id]
  labels       = local.labels

  public_net {
    ipv4_enabled = true
    ipv4         = data.hcloud_primary_ip.main.id
    ipv6_enabled = true
  }

  user_data = templatefile("${path.module}/cloud-init.yaml", {
    public_ipv4 = data.hcloud_primary_ip.main.ip_address
  })

  lifecycle {
    precondition {
      condition     = !data.hcloud_primary_ip.main.auto_delete
      error_message = "The primary IP ${local.project_name} must have auto delete switched off, otherwise the address and the DNS records pointing at it are lost when the server is replaced."
    }
  }
}
