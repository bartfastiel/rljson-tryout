output "node_urls" {
  description = "Public URL of every node, in the order of the nodes variable."
  value       = [for node in var.nodes : "https://${local.hostnames[node.name]}"]
}

output "apex_url" {
  description = "Public URL of the apex host, which routes to the first node."
  value       = "https://${local.apex_hostname}"
}
