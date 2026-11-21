# What the scripts behind make aws-up read from this stack (scripts/aws-*.sh).

output "backend_service" {
  description = "The backend's ECS service, which make aws-start runs."
  value       = aws_ecs_service.backend.name
}

output "backend_template" {
  description = "The family of the backend's task definition template, which each deploy copies into dashgen-backend, pinned to one image."
  value       = aws_ecs_task_definition.backend.family
}

output "deploy_lock_table" {
  description = "The table that lets one deploy run at a time, CI's or make aws-deploy's."
  value       = aws_dynamodb_table.deploy_lock.name
}

output "backend_log_group" {
  description = "Where the backend writes its output."
  value       = aws_cloudwatch_log_group.backend.name
}

output "origin_secret" {
  description = "This session's secret, which CloudFront sends as x-origin-verify, for the session entry that make aws-open writes."
  value       = terraform_data.origin_secret.output
  sensitive   = true
}

output "load_balancer" {
  description = "The load balancer's address, where CloudFront sends /api/*."
  value       = aws_lb.api.dns_name
}

output "ecr_repository_url" {
  description = "Where make aws-image pushes the backend's image: the always-on stack's repository."
  value       = data.aws_ecr_repository.backend.repository_url
}

output "image_tag" {
  description = "The backend's image the session runs: main, CI's, or dev, from make aws-image."
  value       = var.image_tag
}

output "cluster" {
  description = "The ECS cluster that runs the backend's tasks."
  value       = aws_ecs_cluster.main.name
}

output "migrate_template" {
  description = "The family of the migrations task's template, which each deploy copies into dashgen-migrate, pinned to one image."
  value       = aws_ecs_task_definition.migrate.family
}

output "migrate_log_group" {
  description = "Where the migrations task writes its output."
  value       = aws_cloudwatch_log_group.migrate.name
}

output "private_subnets" {
  description = "The private subnets, comma-separated, for aws ecs run-task."
  value       = join(",", aws_subnet.private[*].id)
}

output "backend_security_group" {
  description = "The backend's security group, for aws ecs run-task."
  value       = aws_security_group.backend.id
}
