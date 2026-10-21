output "api_url" {
  description = "Base URL of the API over HTTPS (business routes under /v1, OpenAPI docs at /docs)."
  value       = "https://${aws_cloudfront_distribution.main.domain_name}"
}

output "ecr_repository_url" {
  value = aws_ecr_repository.app.repository_url
}

output "db_instance" {
  value = aws_db_instance.main.identifier
}

output "ecs_cluster" {
  value = aws_ecs_cluster.main.name
}

output "ecs_service" {
  value = aws_ecs_service.app.name
}

output "ssm_prefix" {
  description = "SSM SecureString parameters JWT_SECRET, METRICS_TOKEN and REDIS_PASSWORD live under this path."
  value       = "/${local.name}"
}
