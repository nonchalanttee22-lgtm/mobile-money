# Performance Load Testing Suite

This suite provides tools and scenarios for evaluating the performance and stability of the Mobile Money backend under load.

## Tools Included

1.  **k6 (`tests/load/k6`)**: A sophisticated load testing engine for complex scenarios and ramping loads.
2.  **Autocannon (`tests/load/autocannon`)**: A lightweight benchmarking tool for high-concurrency throughput testing.

---

## 1. Getting Started

### Prerequisites
-   **Node.js**: Required for Autocannon.
-   **k6**: Must be [installed on your system](https://k6.io/docs/getting-started/installation/).

### Running Benchmarks (Easy)
Use the included `npm` script to run a high-concurrency baseline benchmark:
```bash
npm run test:bench
```
This targets health checks and simple API endpoints.

### Running Complex Scenarios (k6)
Run scenarios with ramping virtual users (VUs):
```bash
npm run test:load
```
To run against a remote environment or custom URL:
```bash
BASE_URL=https://your-api.com k6 run tests/load/k6/load_test_scenarios.js
```

---

## 2. Load Scenarios

### **Scenario A: Baseline Stability (Health Checks)**
-   **Goal**: Ensure the server responds to heartbeats even under constant moderate traffic.
-   **Target**: `/health` and `/ready`
-   **Load**: 10 Constant VUs

### **Scenario B: Read Pressure (Transaction History)**
-   **Goal**: Assess database performance during concurrent read operations.
-   **Target**: `/api/transactions`
-   **Load**: Ramping from 0 to 20 VUs over 2 minutes.

### **Scenario C: Write Pressure (Deposits)**
-   **Goal**: Evaluate transaction ACID compliance and queueing performance.
-   **Target**: `/api/transactions/deposit`
-   **Load**: 5 parallel users performing 20 iterations each.

---

## 3. Monitoring & Performance KPIs

### Real-time Monitoring
During the load test, monitor these metrics:
1.  **Response Times**: Check `http_req_duration` in k6 output.
2.  **Success Rate**: Check `http_req_failed` (must be < 1%).
3.  **App Metrics**: Visit `/api/stats` (admin) or the internal prometheus registry.

### Acceptance Criteria (KPIs)
| Metric | Threshold (Typical) | Critical |
| :--- | :--- | :--- |
| **P95 Latency** | < 200ms | < 500ms |
| **P99 Latency** | < 1000ms | < 2000ms |
| **Error Rate** | < 0.1% | < 1.0% |
| **Throughput** | > 50 RPS | > 20 RPS |

---

## 4. Analyzing Effectiveness

To review the effectiveness of these tests, look for:
-   **Bottlenecks**: When does the error rate increase? (Is it at 10, 50, or 100 VUs?)
-   **Resource Usage**: Monitor CPU/Memory on the server during `npm run test:bench`.
-   **DB Contention**: Look for slow queries in the logs during the `read_load` scenario.

---

## 5. Reviewing Load Effectiveness
The effectiveness of a load test is measured by its ability to break the system in a predictable way. If the test passes without surfacing any issues, consider increasing the `vus` or reducing the `timeout` in `tests/load/k6/options.js`.
