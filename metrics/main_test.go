package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"slices"
	"testing"
)

func TestParseMetricsQuery(t *testing.T) {
	tests := []struct {
		name  string
		query string
		days  int
	}{
		{"days defaults to 7", "service=auth-service&metric=errors", 7},
		{"days within the limit", "service=auth-service&metric=errors&days=3", 3},
		{"days capped at 7", "service=auth-service&metric=errors&days=30", 7},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := parseMetricsQuery(mustParseQuery(t, tc.query))
			if err != nil {
				t.Fatalf("error = %v, want nil", err)
			}

			want := metricsQuery{service: "auth-service", metric: "errors", days: tc.days}
			if got != want {
				t.Errorf("got %+v, want %+v", got, want)
			}
		})
	}
}

func TestParseMetricsQueryRejectsBadInput(t *testing.T) {
	tests := []struct {
		name    string
		query   string
		wantErr string
	}{
		{"missing service", "metric=errors", "missing required query param: service"},
		{"missing metric", "service=auth-service", "missing required query param: metric"},
		{"zero days", "service=auth-service&metric=errors&days=0", "days must be a positive integer"},
		{"negative days", "service=auth-service&metric=errors&days=-1", "days must be a positive integer"},
		{"days not a number", "service=auth-service&metric=errors&days=abc", "days must be a positive integer"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, err := parseMetricsQuery(mustParseQuery(t, tc.query))
			if err == nil || err.Error() != tc.wantErr {
				t.Errorf("error = %v, want %q", err, tc.wantErr)
			}
		})
	}
}

func TestHealth(t *testing.T) {
	rec := serve(t, http.MethodGet, "/health")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	var body map[string]string
	decodeJSON(t, rec, &body)
	if body["status"] != "ok" {
		t.Errorf("body = %v, want status ok", body)
	}
}

func TestServices(t *testing.T) {
	rec := serve(t, http.MethodGet, "/services")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	var body struct {
		Services []string `json:"services"`
	}
	decodeJSON(t, rec, &body)
	if !slices.Equal(body.Services, Services) {
		t.Errorf("services = %v, want %v", body.Services, Services)
	}
}

func TestMetrics(t *testing.T) {
	rec := serve(t, http.MethodGet, "/metrics?service=checkout-api&metric=latency_ms&days=3")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	var body struct {
		Service string        `json:"service"`
		Metric  string        `json:"metric"`
		Days    int           `json:"days"`
		Points  []MetricPoint `json:"points"`
	}
	decodeJSON(t, rec, &body)
	if body.Service != "checkout-api" || body.Metric != "latency_ms" || body.Days != 3 {
		t.Errorf("got service %q, metric %q, days %d; want checkout-api, latency_ms, 3",
			body.Service, body.Metric, body.Days)
	}
	if len(body.Points) != 3 {
		t.Errorf("got %d points, want 3", len(body.Points))
	}
}

func TestMetricsErrors(t *testing.T) {
	tests := []struct {
		name    string
		target  string
		wantErr string
	}{
		{"bad query", "/metrics?metric=errors", "missing required query param: service"},
		{"unknown service", "/metrics?service=billing-service&metric=errors", `unknown service "billing-service"`},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			rec := serve(t, http.MethodGet, tc.target)

			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want %d", rec.Code, http.StatusBadRequest)
			}
			var body map[string]string
			decodeJSON(t, rec, &body)
			if body["error"] != tc.wantErr {
				t.Errorf("error = %q, want %q", body["error"], tc.wantErr)
			}
		})
	}
}

func TestRoutes(t *testing.T) {
	tests := []struct {
		name       string
		method     string
		target     string
		wantStatus int
	}{
		{"unknown path", http.MethodGet, "/nope", http.StatusNotFound},
		{"wrong method", http.MethodPost, "/health", http.StatusMethodNotAllowed},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if rec := serve(t, tc.method, tc.target); rec.Code != tc.wantStatus {
				t.Errorf("status = %d, want %d", rec.Code, tc.wantStatus)
			}
		})
	}
}

func TestCORS(t *testing.T) {
	preflight := serve(t, http.MethodOptions, "/metrics")

	if preflight.Code != http.StatusNoContent {
		t.Fatalf("preflight status = %d, want %d", preflight.Code, http.StatusNoContent)
	}
	if got := preflight.Header().Get("Access-Control-Allow-Methods"); got != "GET, OPTIONS" {
		t.Errorf("Access-Control-Allow-Methods = %q, want %q", got, "GET, OPTIONS")
	}
	for _, rec := range []*httptest.ResponseRecorder{preflight, serve(t, http.MethodGet, "/health")} {
		if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "*" {
			t.Errorf("Access-Control-Allow-Origin = %q, want %q", got, "*")
		}
	}
}

// serve sends one request through the same handler main uses.
func serve(t *testing.T, method, target string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	newHandler().ServeHTTP(rec, httptest.NewRequest(method, target, nil))
	return rec
}

// decodeJSON checks that the response is JSON and decodes its body into v.
func decodeJSON(t *testing.T, rec *httptest.ResponseRecorder, v any) {
	t.Helper()
	if got := rec.Header().Get("Content-Type"); got != "application/json" {
		t.Fatalf("Content-Type = %q, want application/json", got)
	}
	if err := json.Unmarshal(rec.Body.Bytes(), v); err != nil {
		t.Fatalf("decode body %q: %v", rec.Body.String(), err)
	}
}

func mustParseQuery(t *testing.T, query string) url.Values {
	t.Helper()
	values, err := url.ParseQuery(query)
	if err != nil {
		t.Fatalf("ParseQuery(%q): %v", query, err)
	}
	return values
}
