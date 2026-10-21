# ElastiCache Redis 7, matching docker-compose: an AUTH token (requirepass) and the
# `noeviction` policy. Every key (sessions, profile cache, rate-limit counters) has a TTL, so
# the default volatile-lru would evict live sessions and silently log users out; with
# noeviction a full Redis rejects writes instead (docs/security.md). An AUTH token requires
# in-transit encryption, so the app connects with REDIS_TLS=true. One node, no replica: the
# demo doesn't need failover.

resource "random_password" "redis_auth" {
  length  = 48
  special = false # ElastiCache AUTH tokens only allow a subset of special characters
}

resource "aws_elasticache_parameter_group" "main" {
  name   = "${local.name}-redis7"
  family = "redis7"

  parameter {
    name  = "maxmemory-policy"
    value = "noeviction"
  }
}

resource "aws_elasticache_subnet_group" "main" {
  name       = local.name
  subnet_ids = aws_subnet.public[*].id
}

resource "aws_elasticache_replication_group" "main" {
  replication_group_id = local.name
  description          = "${local.name} sessions, profile cache and rate limits"

  engine               = "redis"
  engine_version       = "7.1"
  node_type            = var.redis_node_type
  num_cache_clusters   = 1
  parameter_group_name = aws_elasticache_parameter_group.main.name
  port                 = 6379

  subnet_group_name  = aws_elasticache_subnet_group.main.name
  security_group_ids = [aws_security_group.redis.id]

  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  auth_token                 = random_password.redis_auth.result

  automatic_failover_enabled = false
  apply_immediately          = true
  snapshot_retention_limit   = 0
}
