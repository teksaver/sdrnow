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
  }
}

provider "scaleway" {
  zone   = "fr-par-1"
  region = "fr-par"
}

resource "scaleway_instance_ip" "public_ip" {
  zone = "fr-par-1"
}

resource "scaleway_instance_server" "web" {
  name  = "sdrnow-web"
  type  = "STARDUST1-S"
  image = "ubuntu_jammy"
  zone  = "fr-par-1"

  ip_id = scaleway_instance_ip.public_ip.id

  user_data = {
    cloud-init = templatefile("${path.module}/cloud-init.yaml", {
      index_html_b64 = filebase64("${path.module}/../public/index.html")
    })
  }
}

output "server_ip" {
  value = scaleway_instance_ip.public_ip.address
}
