# The session's Postgres (docs/design.md#on-aws): one RDS instance in the
# private subnets, which only the backend's security group can reach. It's
# rebuilt every session, so it keeps no backups. While up it costs about
# $0.02 an hour: $0.016 for the instance, $0.003 for its 20 GB of storage,
# and $0.0005 for the secret with its password.

# The subnets RDS may use. It asks for two zones, even for an instance that
# runs in one.
resource "aws_db_subnet_group" "main" {
  name       = "dashgen"
  subnet_ids = aws_subnet.private[*].id

  tags = { Name = "dashgen" }
}

resource "aws_db_instance" "main" {
  identifier = "dashgen"

  # 18 or later, for the migrations' uuidv7(), like postgres:18-alpine in
  # Docker. Each session makes a new instance of exactly this version, so a
  # newer one comes only from changing it here. To list them:
  # aws rds describe-db-engine-versions --engine postgres
  engine                     = "postgres"
  engine_version             = "18.6"
  auto_minor_version_upgrade = false

  instance_class    = "db.t4g.micro"
  allocated_storage = 20
  storage_type      = "gp3"
  # With RDS's default encryption key, which is free.
  storage_encrypted = true

  # One zone, never reachable from the internet. A second zone (Multi-AZ)
  # would double the cost, for an uptime nobody has promised.
  multi_az               = false
  publicly_accessible    = false
  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.database.id]

  # The database and its admin user are both called dashgen, and the backend
  # signs in as that user (ADR-0015). RDS makes the password and keeps it in a
  # Secrets Manager secret of its own, so it's never in Terraform's state or
  # in the repo, and deletes the secret with the instance. RDS's default
  # settings accept only TLS connections (rds.force_ssl), so the backend must
  # connect with TLS.
  db_name                     = "dashgen"
  username                    = "dashgen"
  manage_master_user_password = true

  # Each session starts it empty, for the migrations and the seed to fill:
  # no backups, no final snapshot, and nothing that stops make aws-down from
  # deleting it.
  backup_retention_period = 0
  skip_final_snapshot     = true
  deletion_protection     = false

  # A change made during a session applies at once, not in the weekly
  # maintenance window.
  apply_immediately = true

  tags = { Name = "dashgen" }
}
