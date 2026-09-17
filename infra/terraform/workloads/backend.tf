# Workspaces store their state under env:/<workspace>/ in front of this key.
terraform {
  backend "s3" {
    bucket       = "bartfastiel-rljson-tryout-tfstate"
    key          = "workloads/terraform.tfstate"
    region       = "eu-central-1"
    use_lockfile = true
    encrypt      = true
  }
}
