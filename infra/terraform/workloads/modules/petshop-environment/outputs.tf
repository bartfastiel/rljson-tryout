output "urls" {
  description = "Public URL of every ingress host: the nodes in the order of the nodes variable, then the apex host when the environment has one."
  value = concat(
    [for node in var.nodes : "https://${local.hostnames[node.name]}"],
    var.enable_apex_ingress ? ["https://${local.apex_hostname}"] : [],
  )
}
