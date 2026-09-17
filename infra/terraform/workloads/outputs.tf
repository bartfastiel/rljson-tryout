output "node_urls" {
  description = "Public URL of every node of the production environment."
  value       = module.production.node_urls
}

output "apex_url" {
  description = "Public URL of the production apex host, which routes to node1."
  value       = module.production.apex_url
}
