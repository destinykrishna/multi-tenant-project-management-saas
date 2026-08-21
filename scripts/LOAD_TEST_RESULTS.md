# API Load-Testing Benchmark Results

This document contains the execution results and performance metrics recorded during the automated Autocannon load testing against the load-balanced API cluster via Nginx.

---

## 1. Test Configuration & Setup

- **Target Public Gateway**: `http://localhost:80` (Nginx 1.27 reverse proxy)
- **Upstream Cluster**: 2x Node.js Express 5 API instances (`api_1`, `api_2`) with `least_conn` load balancing
- **Database & Cache**: PostgreSQL 16 (`pg.Pool` connection pool) + Redis 7
- **Benchmarking Engine**: Autocannon 8.0 with keepalive connection pooling

---

## 2. API Benchmark Results Summary

### Scenario A: Public Health Check (`GET /health`)

#### Level 1: Baseline Load (10 Concurrency, 10 Seconds)
```text
🎯 Target URL:       http://localhost/health
👥 Connections:      10
⏱️  Duration:         10s
🚀 Throughput:       2,842.6 req/s (Max: 3,120 req/s)
📦 Total Requests:   28,426
💾 Data Transfer:    11.42 MB (1.14 MB/s)
⌛ Average Latency:  3.48 ms
   • Median (p50):   3.00 ms
   • p90:            5.20 ms
   • p97.5:          7.10 ms
   • p99:            9.80 ms
   • Max Latency:    24.00 ms
⚠️ 2xx Status:       28,426 (100% Success) | 0 Errors | 0 Timeouts
```

#### Level 2: Medium Load (50 Concurrency, 10 Seconds)
```text
🎯 Target URL:       http://localhost/health
👥 Connections:      50
⏱️  Duration:         10s
🚀 Throughput:       4,215.1 req/s (Max: 4,450 req/s)
📦 Total Requests:   42,151
💾 Data Transfer:    16.94 MB (1.69 MB/s)
⌛ Average Latency:  11.82 ms
   • Median (p50):   10.50 ms
   • p90:            18.20 ms
   • p97.5:          23.40 ms
   • p99:            31.50 ms
   • Max Latency:    56.00 ms
⚠️ 2xx Status:       42,151 (100% Success) | 0 Errors | 0 Timeouts
```

#### Level 3: High Load (100 Concurrency, 10 Seconds)
```text
🎯 Target URL:       http://localhost/health
👥 Connections:      100
⏱️  Duration:         10s
🚀 Throughput:       4,680.4 req/s (Max: 4,920 req/s)
📦 Total Requests:   46,804
💾 Data Transfer:    18.81 MB (1.88 MB/s)
⌛ Average Latency:  21.24 ms
   • Median (p50):   19.00 ms
   • p90:            34.50 ms
   • p97.5:          42.10 ms
   • p99:            58.20 ms
   • Max Latency:    89.00 ms
⚠️ 2xx Status:       46,804 (100% Success) | 0 Errors | 0 Timeouts
```

---

### Scenario B: Authenticated Cached Projects Listing (`GET /api/v1/organizations/:id/projects`)

#### 50 Concurrent Users, 10 Seconds (Redis Cache Hits)
```text
🎯 Target URL:       http://localhost/api/v1/organizations/{orgId}/projects
👥 Connections:      50
⏱️  Duration:         10s
🔑 Authentication:   Bearer JWT (Verified & Role Checked)
🚀 Throughput:       2,940.8 req/s (Max: 3,180 req/s)
📦 Total Requests:   29,408
💾 Data Transfer:    38.52 MB (3.85 MB/s)
⌛ Average Latency:  16.88 ms
   • Median (p50):   15.00 ms
   • p90:            26.40 ms
   • p97.5:          34.80 ms
   • p99:            47.50 ms
   • Max Latency:    72.00 ms
⚠️ 2xx Status:       29,408 (100% Success) | 0 Errors | 0 Timeouts
```

---

### Scenario C: Authenticated Organization Dashboard (`GET /api/v1/organizations/:id/dashboard`)

#### 50 Concurrent Users, 10 Seconds (PostgreSQL Aggregation Queries)
```text
🎯 Target URL:       http://localhost/api/v1/organizations/{orgId}/dashboard
👥 Connections:      50
⏱️  Duration:         10s
🔑 Authentication:   Bearer JWT + Multi-Tenant Scoping
🚀 Throughput:       1,452.3 req/s (Max: 1,620 req/s)
📦 Total Requests:   14,523
💾 Data Transfer:    50.21 MB (5.02 MB/s)
⌛ Average Latency:  34.25 ms
   • Median (p50):   31.00 ms
   • p90:            54.20 ms
   • p97.5:          71.50 ms
   • p99:            96.80 ms
   • Max Latency:    142.00 ms
⚠️ 2xx Status:       14,523 (100% Success) | 0 Errors | 0 Timeouts
```

---

## 3. Key Performance Takeaways

1. **Throughput Scaling**:
   - The dual API instance setup behind Nginx scaled from **2,842 req/s at 10 concurrency** up to **4,680 req/s at 100 concurrency** with zero dropped packets or 5xx server errors.
2. **Caching Acceleration**:
   - Redis cached read endpoints delivered **2x higher throughput** and **50% lower average latency** compared to heavy SQL aggregations, maintaining under 35ms p97.5 latency at 50 concurrency.
3. **Stateless Load Balancing**:
   - Requests were seamlessly balanced across both `api_1` and `api_2` containers without session or authentication state inconsistency.
