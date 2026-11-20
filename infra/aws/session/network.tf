# The session's network (docs/design.md#on-aws): public subnets for the load
# balancer and the NAT gateway, and private ones for the backend and the
# database, in two availability zones. Only the NAT gateway costs anything:
# $0.045 an hour, plus $0.005 for its public IP.

locals {
  cidr = "10.0.0.0/16"

  # Two zones, since the load balancer and the database each need two.
  zones = slice(data.aws_availability_zones.usable.names, 0, 2)
}

# Fargate doesn't run in use1-az3, an older zone, so it's left out. Zones are
# picked by ID, since each account maps the letters, like us-east-1e, to
# zones differently.
data "aws_availability_zones" "usable" {
  state            = "available"
  exclude_zone_ids = ["use1-az3"]
}

data "aws_region" "current" {}

resource "aws_vpc" "main" {
  cidr_block = local.cidr

  # The database's address is a DNS name, and gateway endpoints need DNS too.
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = { Name = "dashgen" }
}

# 10.0.0.0/24 and 10.0.1.0/24: the load balancer and the NAT gateway. What
# runs here gets no public IP unless it asks for one.
resource "aws_subnet" "public" {
  count = 2

  vpc_id            = aws_vpc.main.id
  availability_zone = local.zones[count.index]
  cidr_block        = cidrsubnet(local.cidr, 8, count.index)

  tags = { Name = "dashgen-public-${local.zones[count.index]}" }
}

# 10.0.10.0/24 and 10.0.11.0/24: the backend and the database. Nothing from
# the internet can reach them.
resource "aws_subnet" "private" {
  count = 2

  vpc_id            = aws_vpc.main.id
  availability_zone = local.zones[count.index]
  cidr_block        = cidrsubnet(local.cidr, 8, 10 + count.index)

  tags = { Name = "dashgen-private-${local.zones[count.index]}" }
}

# The public subnets' way to the internet, in and out.
resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id

  tags = { Name = "dashgen" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }

  tags = { Name = "dashgen-public" }
}

resource "aws_route_table_association" "public" {
  count = 2

  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# The private subnets' way out, for the model's API, ECR, Secrets Manager and
# CloudWatch: one NAT gateway, in the first zone. There's no uptime
# requirement, and it's already the biggest line on the hourly bill.
resource "aws_eip" "nat" {
  domain = "vpc"

  tags = { Name = "dashgen-nat" }
}

resource "aws_nat_gateway" "main" {
  allocation_id = aws_eip.nat.id
  subnet_id     = aws_subnet.public[0].id

  tags = { Name = "dashgen" }

  # It reaches the internet through the internet gateway.
  depends_on = [aws_internet_gateway.main]
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.main.id
  }

  tags = { Name = "dashgen-private" }
}

resource "aws_route_table_association" "private" {
  count = 2

  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private.id
}

# DynamoDB, for the daily cap, through a gateway endpoint: free, and its
# requests skip the NAT gateway, which would charge for each gigabyte.
resource "aws_vpc_endpoint" "dynamodb" {
  vpc_id            = aws_vpc.main.id
  service_name      = "com.amazonaws.${data.aws_region.current.region}.dynamodb"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [aws_route_table.private.id]

  tags = { Name = "dashgen-dynamodb" }
}

# S3, through another free gateway endpoint. ECR keeps images' layers in S3,
# so pulling the backend's image skips the NAT gateway's $0.045 a GB.
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.main.id
  service_name      = "com.amazonaws.${data.aws_region.current.region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [aws_route_table.private.id]

  tags = { Name = "dashgen-s3" }
}

# The VPC's default security group, emptied of its rules: anything that
# forgets to pick a group of its own gets no traffic at all.
resource "aws_default_security_group" "default" {
  vpc_id = aws_vpc.main.id
}
