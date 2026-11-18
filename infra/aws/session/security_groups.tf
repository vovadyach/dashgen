# Which parts of the session may talk to which. Each part has a group, and
# each rule names another group rather than addresses, so it holds whatever
# IPs AWS hands out. AWS gives every new group a rule that lets everything
# out; Terraform removes it, so a group allows only the rules written here.

# The load balancer's group: in from CloudFront only, out to the backend only.
resource "aws_security_group" "load_balancer" {
  name        = "dashgen-load-balancer"
  description = "DashGen load balancer, from CloudFront only"
  vpc_id      = aws_vpc.main.id

  tags = { Name = "dashgen-load-balancer" }
}

# CloudFront's addresses toward origins, in a list AWS keeps up to date. Every
# CloudFront customer shares them, so the load balancer also checks this
# session's secret header (load_balancer.tf). The list counts as many rules
# in a group's quota, so this group has no other way in.
data "aws_ec2_managed_prefix_list" "cloudfront" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}

resource "aws_vpc_security_group_ingress_rule" "load_balancer_from_cloudfront" {
  security_group_id = aws_security_group.load_balancer.id
  prefix_list_id    = data.aws_ec2_managed_prefix_list.cloudfront.id
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
  description       = "HTTP, from CloudFront"
}

resource "aws_vpc_security_group_egress_rule" "load_balancer_to_backend" {
  security_group_id            = aws_security_group.load_balancer.id
  referenced_security_group_id = aws_security_group.backend.id
  ip_protocol                  = "tcp"
  from_port                    = 3000
  to_port                      = 3000
  description                  = "The backend, and its health checks"
}

# The backend's tasks join this group, the migrations task too. In, only the
# load balancer; out, Postgres and HTTPS.
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

resource "aws_vpc_security_group_ingress_rule" "backend_from_load_balancer" {
  security_group_id            = aws_security_group.backend.id
  referenced_security_group_id = aws_security_group.load_balancer.id
  ip_protocol                  = "tcp"
  from_port                    = 3000
  to_port                      = 3000
  description                  = "From the load balancer"
}

resource "aws_vpc_security_group_ingress_rule" "database_from_backend" {
  security_group_id            = aws_security_group.database.id
  referenced_security_group_id = aws_security_group.backend.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  description                  = "Postgres, from the backend"
}
