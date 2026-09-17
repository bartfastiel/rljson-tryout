output "server_ipv4" {
  description = "Public IPv4 address of the k3s server."
  value       = hcloud_server.main.ipv4_address
}

output "ssh_private_key" {
  description = "OpenSSH private key matching the public key installed on the server."
  value       = tls_private_key.main.private_key_openssh
  sensitive   = true
}
