variable "server_type" {
  description = "Hetzner server type of the k3s server. The plan fails when the type does not exist or is not available in the primary IP's location."
  type        = string
  default     = "cpx32"
}
