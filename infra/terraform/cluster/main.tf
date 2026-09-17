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

# Resolving the type and the image at plan time turns a retired name or a
# sold out type into a failed plan on the pull request instead of a failed
# apply on main. Availability is per location in the server type's
# `locations` list; Hetzner is retiring the older datacenter granularity.
data "hcloud_server_type" "main" {
  name = var.server_type
}

# The server references the image by name, not by id, so that a
# re-published image with a new id does not replace the server.
data "hcloud_image" "main" {
  name              = "ubuntu-24.04"
  with_architecture = data.hcloud_server_type.main.architecture
}

locals {
  server_type_in_location = one([
    for location in data.hcloud_server_type.main.locations :
    location if location.name == data.hcloud_primary_ip.main.location
  ])
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
  server_type  = data.hcloud_server_type.main.name
  image        = data.hcloud_image.main.name
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
    precondition {
      condition     = try(local.server_type_in_location.available, false)
      error_message = "Server type ${data.hcloud_server_type.main.name} is not available in location ${data.hcloud_primary_ip.main.location}; choose another one through the variable server_type."
    }
  }
}

# Waits until cloud-init has finished and the node is Ready, then reads the
# kubeconfig k3s wrote for the local machine. Re-runs only when the server
# is replaced; `cloud-init status --wait` exits non-zero on recoverable
# warnings, which must not abort the hand-off.
resource "ssh_sensitive_resource" "kubeconfig" {
  host        = hcloud_server.main.ipv4_address
  user        = "root"
  private_key = tls_private_key.main.private_key_openssh
  timeout     = "15m"
  retry_delay = "5s"

  triggers = {
    server_id = tostring(hcloud_server.main.id)
  }

  commands = [
    "cloud-init status --wait > /dev/null || true",
    "until k3s kubectl get nodes --no-headers 2>/dev/null | grep -q ' Ready '; do sleep 5; done",
    "cat /etc/rancher/k3s/k3s.yaml",
  ]
}
