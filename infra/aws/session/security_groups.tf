# Which parts of the session may talk to which. Each part has a group, and
# each rule names another group rather than addresses, so it holds whatever
# IPs AWS hands out. AWS gives every new group a rule that lets everything
# out; Terraform removes it, so a group allows only the rules written here.

# The backend's tasks join this group, the migrations task first. Its rules
# say where they may go: Postgres, and HTTPS.
resource "aws_security_group" "backend" {
  name        = "dashgen-backend"
  description = "DashGen backend"
  vpc_id      = aws_vpc.main.id

  tags = { Name = "dashgen-backend" }
}

# The database's group, whose one rule lets in only the backend.
resource "aws_security_group" "database" {
  name        = "dashgen-database"
  description = "DashGen Postgres, only from the backend"
  vpc_id      = aws_vpc.main.id

  tags = { Name = "dashgen-database" }
}

# Postgres's port, 5432, from the backend's group to the database's: once
# going out of one, and once coming into the other. Replies need no rule,
# since a group always lets them back.
resource "aws_vpc_security_group_egress_rule" "backend_to_database" {
  security_group_id            = aws_security_group.backend.id
  referenced_security_group_id = aws_security_group.database.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  description                  = "Postgres"
}

# HTTPS, through the NAT gateway or a gateway endpoint: ECR for the image,
# Secrets Manager, CloudWatch Logs, DynamoDB, and later Gemini. DNS needs no
# rule, since a group never filters the VPC's own DNS server.
resource "aws_vpc_security_group_egress_rule" "backend_to_https" {
  security_group_id = aws_security_group.backend.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  description       = "HTTPS"
}

resource "aws_vpc_security_group_ingress_rule" "database_from_backend" {
  security_group_id            = aws_security_group.database.id
  referenced_security_group_id = aws_security_group.backend.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  description                  = "Postgres, from the backend"
}
