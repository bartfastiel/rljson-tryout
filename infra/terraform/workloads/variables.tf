variable "image_tag" {
  description = "Tag of the node service image to deploy; the pipeline passes the commit sha the image job pushed."
  type        = string

  validation {
    condition     = length(var.image_tag) > 0
    error_message = "The image tag must not be empty."
  }
}

variable "image_repository" {
  description = "Container image repository of the node service."
  type        = string
  default     = "ghcr.io/bartfastiel/rljson-tryout/node-service"
}

variable "base_domain" {
  description = "Domain under which the node hostnames live; the wildcard DNS record below it points at the cluster."
  type        = string
  default     = "rljson-tryout.wer-ist-daniel-schwarz.de"
}

variable "letsencrypt_email" {
  description = "Contact address of the ACME account at Let's Encrypt; the pipeline passes the repository secret LETSENCRYPT_EMAIL."
  type        = string
  sensitive   = true

  validation {
    condition     = can(regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", var.letsencrypt_email))
    error_message = "The Let's Encrypt email must be an address of the form name@domain.tld."
  }
}
