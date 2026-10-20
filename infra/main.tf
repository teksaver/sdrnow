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

# --- Scaleway Transactional Email (alertes « Prospect Chaud » & digest de minuit) ---

resource "scaleway_tem_domain" "sdrnow" {
  name       = "sdrnow.fr"
  region     = "fr-par"
  accept_tos = true
}

# DNS records to publish at Infomaniak (the sdrnow.fr zone is not hosted on Scaleway Domains)
output "tem_spf_config" {
  description = "SPF include to merge into the sdrnow.fr TXT record (e.g. v=spf1 include:_spf.scw-tem.cloud -all)"
  value       = scaleway_tem_domain.sdrnow.spf_config
}

output "tem_dkim_name" {
  description = "DKIM TXT record name"
  value       = scaleway_tem_domain.sdrnow.dkim_name
}

output "tem_dkim_config" {
  description = "DKIM TXT record value"
  value       = scaleway_tem_domain.sdrnow.dkim_config
}

output "tem_dmarc_name" {
  description = "DMARC TXT record name"
  value       = scaleway_tem_domain.sdrnow.dmarc_name
}

output "tem_dmarc_config" {
  description = "DMARC TXT record value"
  value       = scaleway_tem_domain.sdrnow.dmarc_config
}

# Least-privilege API key for the VM: it can only send TEM emails in this project.
# The VM never receives the CI deployment key (SCW_SECRET_KEY).
# CI has no SCW_DEFAULT_ORGANIZATION_ID: the organization is read from the project.
data "scaleway_account_project" "current" {
  project_id = scaleway_tem_domain.sdrnow.project_id
}

resource "scaleway_iam_application" "tem_sender" {
  organization_id = data.scaleway_account_project.current.organization_id
  name            = "sdrnow-tem-sender"
  description     = "SDRnow VM: envoi des alertes Radar via Scaleway Transactional Email"
}

resource "scaleway_iam_policy" "tem_sender" {
  organization_id = data.scaleway_account_project.current.organization_id
  name            = "sdrnow-tem-send-only"
  description     = "Envoi d'emails TEM uniquement, limité au projet SDRnow"
  application_id  = scaleway_iam_application.tem_sender.id

  rule {
    project_ids          = [scaleway_tem_domain.sdrnow.project_id]
    permission_set_names = ["TransactionalEmailEmailApiCreate"]
  }
}

resource "scaleway_iam_api_key" "tem_sender" {
  application_id     = scaleway_iam_application.tem_sender.id
  default_project_id = scaleway_tem_domain.sdrnow.project_id
  description        = "SDRnow VM - TEM send-only key (TEM_SECRET_KEY)"
}

output "tem_secret_key" {
  value     = scaleway_iam_api_key.tem_sender.secret_key
  sensitive = true
}
