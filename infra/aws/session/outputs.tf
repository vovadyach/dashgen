# What the scripts behind make aws-up read from this stack (scripts/aws-*.sh).

output "backend_service" {
  description = "The backend's ECS service, which make aws-start runs."
  value       = aws_ecs_service.backend.name
}

output "backend_log_group" {
  description = "Where the backend writes its output."
  value       = aws_cloudwatch_log_group.backend.name
}

output "load_balancer" {
  description = "The load balancer's address, where CloudFront sends /api/*."
  value       = aws_lb.api.dns_name
}

output "ecr_repository_url" {
  description = "Where make aws-image pushes the backend's image."
  value       = aws_ecr_repository.backend.repository_url
}

output "cluster" {
  description = "The ECS cluster that runs the backend's tasks."
  value       = aws_ecs_cluster.main.name
}

output "migrate_task" {
  description = "The migrations task's family: ECS runs its latest revision."
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
