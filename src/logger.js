const config = require('./config');

function sanitize(data) {
  if (data === null || data === undefined) return data;

  if (Array.isArray(data)) {
    return data.map((item) => sanitize(item));
  }

  if (typeof data === 'object') {
    const sanitized = {};

    for (const [key, value] of Object.entries(data)) {
      const lowerKey = key.toLowerCase();

      if (
        lowerKey.includes('password') ||
        lowerKey.includes('token') ||
        lowerKey.includes('jwt') ||
        lowerKey === 'authorization' ||
        lowerKey.includes('apikey')
      ) {
        sanitized[key] = '[REDACTED]';
      } else {
        sanitized[key] = sanitize(value);
      }
    }

    return sanitized;
  }

  return data;
}

async function log(eventType, data = {}) {
  if (process.env.NODE_ENV === 'test') {
    return;
  }

  try {
    const payload = {
      streams: [
        {
          stream: {
            source: config.logging.source,
            type: eventType,
          },
          values: [[`${Date.now() * 1000000}`, JSON.stringify(sanitize(data))]],
        },
      ],
    };

    await fetch(config.logging.endpointUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${Buffer.from(
          `${config.logging.accountId}:${config.logging.apiKey}`
        ).toString('base64')}`,
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
  }
}

function httpLogger(req, res, next) {
  const start = Date.now();

  const originalJson = res.json.bind(res);
  let responseBody = null;

  res.json = function (body) {
    responseBody = body;
    return originalJson(body);
  };

  res.on('finish', () => {
    log('http', {
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      hasAuthorization: !!req.headers.authorization,
      requestBody: sanitize(req.body || {}),
      responseBody: sanitize(responseBody),
      durationMs: Date.now() - start,
    });
  });

  next();
}

module.exports = {
  log,
  sanitize,
  httpLogger,
};