output "deployment_urls" {
  description = "Public URL of every ingress host of this workspace's environment: the nodes first, then the apex host in production."
  value       = module.environment.urls
}
