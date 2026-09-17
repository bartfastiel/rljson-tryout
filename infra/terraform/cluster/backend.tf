terraform {
  backend "s3" {
    bucket       = "bartfastiel-rljson-tryout-tfstate"
    key          = "cluster/terraform.tfstate"
    region       = "eu-central-1"
    use_lockfile = true
    encrypt      = true
  }
}
