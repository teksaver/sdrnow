terraform {
  backend "s3" {
    bucket                      = "sdrnow-tfstate"
    key                         = "terraform.tfstate"
    region                      = "fr-par"
    endpoints                   = { s3 = "https://s3.fr-par.scw.cloud" }
    skip_credentials_validation = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
  }
  required_providers {
    scaleway = {
      source  = "scaleway/scaleway"
      version = "~> 2.45"
    }
    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.0"
    }
  }
}

provider "scaleway" {
  zone   = "fr-par-1"
  region = "fr-par"
}

resource "scaleway_instance_ip" "public_ip" {
  zone = "fr-par-1"
}

variable "staging_password_hash" {
  description = "Bcrypt hash for the staging environment basic auth"
  type        = string
}

resource "tls_private_key" "deploy" {
  algorithm = "ED25519"
}

resource "terraform_data" "cloud_init" {
  input = templatefile("${path.module}/cloud-init.yaml", {
    staging_password_hash = var.staging_password_hash
    deploy_public_key     = tls_private_key.deploy.public_key_openssh
  })
}

resource "scaleway_instance_server" "web" {
  name  = "sdrnow-web-v6"
  type  = "STARDUST1-S"
  image = "ubuntu_jammy"
  zone  = "fr-par-1"

  ip_id = scaleway_instance_ip.public_ip.id

  user_data = {
    cloud-init = terraform_data.cloud_init.output
  }

  lifecycle {
    ignore_changes = [user_data]
  }
}

output "server_ip" {
  value = scaleway_instance_ip.public_ip.address
}

output "deploy_private_key" {
  value     = tls_private_key.deploy.private_key_openssh
  sensitive = true
}
