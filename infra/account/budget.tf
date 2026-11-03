# The monthly budget (docs/runbooks/aws-account.md). A budget only sends alerts:
# it never stops spending.
resource "aws_budgets_budget" "monthly_total" {
  name         = "monthly-total"
  budget_type  = "COST"
  limit_amount = "50"
  limit_unit   = "USD"
  time_unit    = "MONTHLY"
  metrics      = ["UnblendedCost"]

  # Costs before credits, so the alerts also fire while credits pay the bill.
  filter_expression {
    not {
      dimensions {
        key    = "RECORD_TYPE"
        values = ["Credit"]
      }
    }
  }

  # An email at 20%, 50% and 100% of $50: $10, $25 and $50 of actual costs.
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 20
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.alert_email]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 50
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.alert_email]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.alert_email]
  }

  # This stack stays on: terraform destroy must never delete the alerts.
  lifecycle {
    prevent_destroy = true
  }
}
