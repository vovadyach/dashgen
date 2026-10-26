package main

import (
	"slices"
	"strings"
	"testing"
	"time"
)

func TestGetMetricsReturnsTheLastDays(t *testing.T) {
	tests := []struct {
		name    string
		service string
		metric  string
		days    int
		want    []float64
	}{
		{"all days", "auth-service", "errors", 7, rawErrors["auth-service"]},
		{"last three days", "checkout-api", "latency_ms", 3, rawLatency["checkout-api"][4:]},
		{"more days than the data has", "payments-service", "errors", 30, rawErrors["payments-service"]},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			points, err := GetMetrics(tc.service, tc.metric, tc.days)
			if err != nil {
				t.Fatalf("GetMetrics() error = %v", err)
			}

			got := make([]float64, len(points))
			for i, p := range points {
				got[i] = p.Value
			}
			if !slices.Equal(got, tc.want) {
				t.Errorf("values = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestGetMetricsDatesRunOldestFirstToToday(t *testing.T) {
	before := time.Now().UTC().Format(time.DateOnly)
	points, err := GetMetrics("search-service", "errors", maxDays)
	after := time.Now().UTC().Format(time.DateOnly)
	if err != nil {
		t.Fatalf("GetMetrics() error = %v", err)
	}
	if len(points) != maxDays {
		t.Fatalf("got %d points, want %d", len(points), maxDays)
	}

	// before and after differ only when the call runs across midnight UTC.
	if last := points[len(points)-1].Date; last != before && last != after {
		t.Errorf("last date = %s, want today (UTC), %s", last, after)
	}
	for i := 1; i < len(points); i++ {
		prev, err := time.Parse(time.DateOnly, points[i-1].Date)
		if err != nil {
			t.Fatal(err)
		}
		cur, err := time.Parse(time.DateOnly, points[i].Date)
		if err != nil {
			t.Fatal(err)
		}
		if cur.Sub(prev) != 24*time.Hour {
			t.Errorf("date %d = %s, want the day after %s", i, points[i].Date, points[i-1].Date)
		}
	}
}

func TestGetMetricsRejectsUnknownNames(t *testing.T) {
	tests := []struct {
		name    string
		service string
		metric  string
		wantErr string
	}{
		{"unknown service", "billing-service", "errors", `unknown service "billing-service"`},
		{"unknown metric", "auth-service", "cpu", `unknown metric "cpu"`},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, err := GetMetrics(tc.service, tc.metric, maxDays)
			if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
				t.Errorf("error = %v, want one containing %q", err, tc.wantErr)
			}
		})
	}
}
