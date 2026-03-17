/* istanbul ignore file */
const config = require('./config');
const os = require('os');

const requests = {};
const endpointLatencies = {};

const authAttempts = {
  success: 0,
  failure: 0,
};

let activeUsers = 0;

const pizzaStats = {
  sold: 0,
  failures: 0,
  revenue: 0,
  latencyTotal: 0,
  latencyCount: 0,
};

function requestTracker(req, res, next) {
  const start = Date.now();
  const key = `${req.method} ${req.path}`;

  requests[key] = (requests[key] || 0) + 1;

  res.on('finish', () => {
    const latency = Date.now() - start;

    if (!endpointLatencies[key]) {
      endpointLatencies[key] = { total: 0, count: 0 };
    }

    endpointLatencies[key].total += latency;
    endpointLatencies[key].count += 1;
  });

  next();
}

function authAttempt(success) {
  if (success) {
    authAttempts.success += 1;
  } else {
    authAttempts.failure += 1;
  }
}

function userLoggedIn() {
  activeUsers += 1;
}

function userLoggedOut() {
  activeUsers = Math.max(0, activeUsers - 1);
}

function pizzaPurchase(success, latency, revenue = 0, count = 1) {
  if (success) {
    pizzaStats.sold += count;
    pizzaStats.revenue += revenue;
  } else {
    pizzaStats.failures += 1;
  }

  pizzaStats.latencyTotal += latency;
  pizzaStats.latencyCount += 1;
}

function getCpuUsagePercentage() {
  const usage = process.cpuUsage();
  const totalMicros = usage.user + usage.system;
  const percent = Number(((totalMicros % 1000000) / 10000).toFixed(2));
  return percent > 0 ? percent : 0.1;
}

function getMemoryUsagePercentage() {
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const usedMemory = totalMemory - freeMemory;
  return Number(((usedMemory / totalMemory) * 100).toFixed(2));
}

function createMetric(metricName, metricValue, metricUnit, metricType, valueType, attributes = {}) {
  attributes = { ...attributes, source: config.metrics.source };

  const metric = {
    name: metricName,
    unit: metricUnit,
    [metricType]: {
      dataPoints: [
        {
          [valueType]: metricValue,
          timeUnixNano: String(Date.now() * 1000000),
          attributes: [],
        },
      ],
    },
  };

  Object.keys(attributes).forEach((key) => {
    metric[metricType].dataPoints[0].attributes.push({
      key,
      value: { stringValue: String(attributes[key]) },
    });
  });

  if (metricType === 'sum') {
    metric[metricType].aggregationTemporality = 'AGGREGATION_TEMPORALITY_CUMULATIVE';
    metric[metricType].isMonotonic = true;
  }

  return metric;
}

async function sendMetricToGrafana(metrics) {
  const body = {
    resourceMetrics: [
      {
        scopeMetrics: [
          {
            metrics,
          },
        ],
      },
    ],
  };

  const basicAuth = Buffer.from(
    `${config.metrics.accountId}:${config.metrics.apiKey}`
  ).toString('base64');

  const response = await fetch(config.metrics.endpointUrl, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Grafana push failed: ${response.status} ${text}`);
  }
}

function resetPeriodicCounters() {
  Object.keys(endpointLatencies).forEach((key) => {
    endpointLatencies[key] = { total: 0, count: 0 };
  });

  pizzaStats.latencyTotal = 0;
  pizzaStats.latencyCount = 0;
}

function startPeriodicMetricsReporting(period = 10000) {
  setInterval(async () => {
    try {
      const metrics = [];

      Object.keys(requests).forEach((key) => {
        const [method, ...pathParts] = key.split(' ');
        const path = pathParts.join(' ');

        metrics.push(
          createMetric('http_requests', requests[key], '1', 'sum', 'asInt', {
            method,
            path,
          })
        );
      });

      Object.keys(endpointLatencies).forEach((key) => {
        const latencyInfo = endpointLatencies[key];
        const avgLatency =
          latencyInfo.count > 0 ? Number((latencyInfo.total / latencyInfo.count).toFixed(2)) : 0;

        const [method, ...pathParts] = key.split(' ');
        const path = pathParts.join(' ');

        metrics.push(
          createMetric('endpoint_latency', avgLatency, 'ms', 'gauge', 'asDouble', {
            method,
            path,
          })
        );
      });

      metrics.push(
        createMetric('auth_attempts', authAttempts.success, '1', 'sum', 'asInt', {
          result: 'success',
        })
      );

      metrics.push(
        createMetric('auth_attempts', authAttempts.failure, '1', 'sum', 'asInt', {
          result: 'failure',
        })
      );

      metrics.push(
        createMetric('active_users', activeUsers, '1', 'gauge', 'asInt', {})
      );

      metrics.push(
        createMetric('cpu_usage', getCpuUsagePercentage(), '%', 'gauge', 'asDouble', {})
      );

      metrics.push(
        createMetric('memory_usage', getMemoryUsagePercentage(), '%', 'gauge', 'asDouble', {})
      );

      metrics.push(
        createMetric('pizzas_sold', pizzaStats.sold, '1', 'sum', 'asInt', {})
      );

      metrics.push(
        createMetric('pizza_failures', pizzaStats.failures, '1', 'sum', 'asInt', {})
      );

      metrics.push(
        createMetric(
          'pizza_revenue',
          Number(pizzaStats.revenue.toFixed(2)),
          '1',
          'sum',
          'asDouble',
          {}
        )
      );

      if (pizzaStats.latencyCount > 0) {
        const avgPizzaLatency = Number(
            (pizzaStats.latencyTotal / pizzaStats.latencyCount).toFixed(2)
        );

        metrics.push(
        createMetric('pizza_latency', avgPizzaLatency, 'ms', 'gauge', 'asDouble', {})
        );
    }

      console.log('Sending metrics to:', config.metrics.endpointUrl);
      console.log('Metric count:', metrics.length);

      await sendMetricToGrafana(metrics);

      console.log('Metrics sent successfully');
      resetPeriodicCounters();
    } catch (error) {
      console.error('Error sending metrics:', error.message);
    }
  }, period);
}

module.exports = {
  requestTracker,
  authAttempt,
  userLoggedIn,
  userLoggedOut,
  pizzaPurchase,
  startPeriodicMetricsReporting,
};