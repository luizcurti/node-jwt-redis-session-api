variable "project_name" {
  description = "Prefix of every resource name. Must match project_name in ../bootstrap (the deploy role is scoped by it)."
  type        = string
  default     = "jwt-session"
}

variable "aws_region" {
  description = "AWS region of the stack (CloudFront itself is global)."
  type        = string
  default     = "eu-west-2"
}

variable "app_image_tag" {
  description = "Tag of the app image in ECR, pushed by the CI deploy job before apply (the commit SHA)."
  type        = string
  default     = "latest"
}

variable "vpc_cidr" {
  description = "CIDR of the VPC. Two public /24 subnets are carved out of it."
  type        = string
  default     = "10.44.0.0/16"
}

variable "app_cpu" {
  description = "Fargate CPU units for the API task (256 = 0.25 vCPU)."
  type        = number
  default     = 256
}

variable "app_memory" {
  description = "Fargate memory (MiB) for the API task."
  type        = number
  default     = 512
}

variable "db_instance_class" {
  description = "RDS instance class. db.t4g.micro is free-tier eligible on new accounts."
  type        = string
  default     = "db.t4g.micro"
}

variable "redis_node_type" {
  description = "ElastiCache node type."
  type        = string
  default     = "cache.t4g.micro"
}

variable "log_retention_days" {
  description = "CloudWatch Logs retention for the API container logs."
  type        = number
  default     = 14
}
