# PostgreSQL 17, the version docker-compose and CI use. The master password is generated and
# stored by RDS in Secrets Manager; the task reads it from there, so it never appears in
# Terraform state or the task definition.
#
# TLS: RDS defaults rds.force_ssl to 1, and the app's pg Pool and migration runner connect
# without TLS (as they do to the local container), which RDS rejects ("no pg_hba.conf entry ...
# no encryption"). The parameter group below turns it off. The connection stays inside the VPC:
# the instance is not publicly accessible and its security group only admits the API task.
# Enabling TLS would mean shipping the RDS CA bundle in the image and an `ssl` option in
# src/postgres.ts and scripts/migrate.js.

resource "aws_db_parameter_group" "main" {
  name   = "${local.name}-postgres17"
  family = "postgres17"

  parameter {
    name         = "rds.force_ssl"
    value        = "0"
    apply_method = "immediate"
  }
}

resource "aws_db_subnet_group" "main" {
  name       = local.name
  subnet_ids = aws_subnet.public[*].id
}

resource "aws_db_instance" "main" {
  identifier     = local.name
  engine         = "postgres"
  engine_version = "17"
  instance_class = var.db_instance_class

  allocated_storage = 20
  storage_type      = "gp3"
  storage_encrypted = true

  db_name                     = "sessions"
  username                    = "app"
  manage_master_user_password = true

  parameter_group_name   = aws_db_parameter_group.main.name
  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.db.id]
  publicly_accessible    = false
  multi_az               = false

  # Demo stack, torn down by the Destroy workflow: no final snapshot, no deletion protection.
  backup_retention_period    = 1
  skip_final_snapshot        = true
  deletion_protection        = false
  apply_immediately          = true
  auto_minor_version_upgrade = true
}
