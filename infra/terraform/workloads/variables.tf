variable "image" {
  description = "Full reference of the node service image to deploy, registry path and tag; the pipeline passes what the image job pushed for the same commit."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9./-]+:[A-Za-z0-9_.-]+$", var.image))
    error_message = "The image must be a lower-case registry path followed by a colon and a tag."
  }
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
