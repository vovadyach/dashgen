package main

import (
	"fmt"
	"time"
)

// MetricPoint is a single (date, value) pair returned in the metrics API.
type MetricPoint struct {
	Date  string  `json:"date"`  // ISO YYYY-MM-DD, UTC
	Value float64 `json:"value"` // count for errors, milliseconds for latency
}

// Services is the canonical list of services this fake backend knows about.
// Order here is the order returned by GET /services.
var Services = []string{
	"auth-service",
	"payments-service",
	"checkout-api",
	"search-service",
	"notifications-worker",
}

// rawErrors holds 7 daily error counts per service, oldest first (index 0 = 6
// days ago, index 6 = today). Patterns are deliberately varied so the
// natural-language dashboard demo has something interesting to surface.
var rawErrors = map[string][]float64{
	"auth-service":         {12, 8, 15, 11, 45, 20, 14},  // spike on day 4
	"payments-service":     {3, 2, 4, 3, 5, 2, 3},        // very stable / low
	"checkout-api":         {25, 22, 28, 30, 35, 33, 38}, // upward trend
	"search-service":       {18, 19, 17, 20, 16, 21, 19}, // noisy stable
	"notifications-worker": {7, 9, 8, 10, 12, 11, 13},    // mild upward
}

// rawLatency holds 7 daily latency_ms values per service, oldest first.
var rawLatency = map[string][]float64{
	"auth-service":         {120, 115, 118, 122, 145, 130, 119}, // mirrors error spike
	"payments-service":     {220, 215, 225, 218, 230, 222, 228},
	"checkout-api":         {340, 360, 350, 380, 410, 400, 425}, // trending up
	"search-service":       {85, 90, 82, 88, 95, 86, 92},
	"notifications-worker": {55, 60, 58, 62, 65, 63, 68},
}

// generateDates returns n ISO date strings, oldest first, ending today (UTC).
// e.g. n=3 → ["2026-04-23", "2026-04-24", "2026-04-25"].
func generateDates(n int) []string {
	dates := make([]string, n)
	now := time.Now().UTC()
	for i := range n {
		d := now.AddDate(0, 0, -(n - 1 - i))
		dates[i] = d.Format("2006-01-02")
	}
	return dates
}

// GetMetrics returns the last `days` data points for the given service+metric.
// Returns an error if service or metric is unknown.
func GetMetrics(service, metric string, days int) ([]MetricPoint, error) {
	var raw map[string][]float64
	switch metric {
	case "errors":
		raw = rawErrors
	case "latency_ms":
		raw = rawLatency
	default:
		return nil, fmt.Errorf("unknown metric %q (valid: errors, latency_ms)", metric)
	}

	values, ok := raw[service]
	if !ok {
		return nil, fmt.Errorf("unknown service %q", service)
	}

	if days > len(values) {
		days = len(values)
	}
	start := len(values) - days
	sliced := values[start:]
	dates := generateDates(days)

	points := make([]MetricPoint, days)
	for i := 0; i < days; i++ {
		points[i] = MetricPoint{Date: dates[i], Value: sliced[i]}
	}
	return points, nil
}
