variable "environment_name" {
  description = "Name of the Kubernetes namespace that holds this environment, for example petshop or pr-42."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9]([a-z0-9-]*[a-z0-9])?$", var.environment_name))
    error_message = "The environment name must be a DNS label: lower-case letters, digits and dashes."
  }
}

variable "image" {
  description = "Full container image reference of the node service, including the tag."
  type        = string
}

variable "base_domain" {
  description = "Domain under which the node hostnames live, for example rljson-tryout.example.org."
  type        = string
}

variable "hostname_infix" {
  description = "Inserted between the node name and the base domain; empty in production, -pr-<number> in previews. The apex host of a preview is the infix without its leading dash."
  type        = string

  validation {
    condition     = var.hostname_infix == "" || can(regex("^-[a-z0-9-]*[a-z0-9]$", var.hostname_infix))
    error_message = "The hostname infix must be empty or start with a dash followed by lower-case letters, digits and dashes."
  }
}

variable "nodes" {
  description = "Nodes of this environment in display order; the first one also answers on the apex host. Every node runs the in-memory store."
  type = list(object({
    name = string
  }))

  validation {
    condition     = length(var.nodes) > 0
    error_message = "An environment needs at least one node."
  }

  validation {
    condition     = length(distinct([for node in var.nodes : node.name])) == length(var.nodes)
    error_message = "Node names must be unique."
  }

  validation {
    condition     = alltrue([for node in var.nodes : can(regex("^[a-z0-9]([a-z0-9-]*[a-z0-9])?$", node.name))])
    error_message = "Node names must be DNS labels: lower-case letters, digits and dashes."
  }
}
