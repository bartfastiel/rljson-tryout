output "server_ipv4" {
  description = "Public IPv4 address of the k3s server."
  value       = hcloud_server.main.ipv4_address
}

output "ssh_private_key" {
  description = "OpenSSH private key matching the public key installed on the server."
  value       = tls_private_key.main.private_key_openssh
  sensitive   = true
}

output "kubeconfig" {
  description = "Kubeconfig with cluster administrator rights, pointing at the public address of the server."
  value       = replace(ssh_sensitive_resource.kubeconfig.result, "127.0.0.1", hcloud_server.main.ipv4_address)
  sensitive   = true
}
