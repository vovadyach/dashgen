package main

import (
	"cmp"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"net/url"
	"os"
	"strconv"
)

const maxDays = 7

type metricsQuery struct {
	service string
	metric  string
	days    int
}

func main() {
	mux := http.NewServeMux()
	// Go 1.22 method-aware routing: pattern includes the HTTP verb.
	mux.HandleFunc("GET /health", handleHealth)
	mux.HandleFunc("GET /services", handleServices)
	mux.HandleFunc("GET /metrics", handleMetrics)

	addr := ":" + cmp.Or(os.Getenv("PORT"), "8080")

	log.Printf("metrics service listening on %s", addr)
	if err := http.ListenAndServe(addr, withCORS(mux)); err != nil {
		log.Fatal(err)
	}
}

// withCORS adds permissive CORS headers and short-circuits preflight requests.
// Permissive is fine here: this service holds no auth and no real data.
func withCORS(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		h.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("encode response: %v", err)
	}
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func handleServices(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"services": Services})
}

func parseMetricsQuery(q url.Values) (metricsQuery, error) {
	mq := metricsQuery{
		service: q.Get("service"),
		metric:  q.Get("metric"),
		days:    maxDays,
	}
	if mq.service == "" {
		return mq, errors.New("missing required query param: service")
	}
	if mq.metric == "" {
		return mq, errors.New("missing required query param: metric")
	}
	if s := q.Get("days"); s != "" {
		n, err := strconv.Atoi(s)
		if err != nil || n < 1 {
			return mq, errors.New("days must be a positive integer")
		}
		mq.days = min(n, maxDays)
	}
	return mq, nil
}

func handleMetrics(w http.ResponseWriter, r *http.Request) {
	mq, err := parseMetricsQuery(r.URL.Query())
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	points, err := GetMetrics(mq.service, mq.metric, mq.days)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"service": mq.service,
		"metric":  mq.metric,
		"days":    mq.days,
		"points":  points,
	})
}
