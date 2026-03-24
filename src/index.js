const app = require('./service.js');
const metrics = require('./metrics');
const logger = require('./logger');

const port = process.argv[2] || 3000;

process.on('uncaughtException', (err) => {
  logger.log('uncaughtException', {
    message: err.message,
    stack: err.stack,
  });
});

process.on('unhandledRejection', (err) => {
  logger.log('unhandledRejection', {
    message: err?.message,
    stack: err?.stack,
  });
});

metrics.startPeriodicMetricsReporting();

app.listen(port, () => {
  console.log(`Server started on port ${port}`);
});