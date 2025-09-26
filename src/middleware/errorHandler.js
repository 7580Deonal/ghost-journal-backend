const errorHandler = (err, req, res, next) => {
  console.error(`Error: ${err.message}`);
  console.error(err.stack);

  if (err.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      error: 'Validation Error',
      message: err.message,
      details: err.details || null
    });
  }

  if (err.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        error: 'File Too Large',
        message: 'Screenshot file size exceeds 10MB limit'
      });
    }
    return res.status(400).json({
      success: false,
      error: 'Upload Error',
      message: err.message
    });
  }

  if (err.code === 'ANTHROPIC_API_ERROR') {
    return res.status(503).json({
      success: false,
      error: 'AI Analysis Unavailable',
      message: 'Trading analysis service temporarily unavailable'
    });
  }

  if (err.code === 'ENOENT') {
    return res.status(404).json({
      success: false,
      error: 'File Not Found',
      message: 'Requested file does not exist'
    });
  }

  if (err.code === 'SQLITE_ERROR') {
    return res.status(500).json({
      success: false,
      error: 'Database Error',
      message: 'Failed to process trading data'
    });
  }

  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    success: false,
    error: statusCode === 500 ? 'Internal Server Error' : 'Error',
    message: statusCode === 500 ? 'Something went wrong on our end' : err.message
  });
};

const notFound = (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint Not Found',
    message: `Route ${req.originalUrl} not found`,
    availableEndpoints: {
      health: 'GET /api/health',
      upload: 'POST /api/upload-trade',
      execution: 'POST /api/trade/{id}/execution',
      complete_analysis: 'GET /api/trade/{id}/complete',
      trade_details: 'GET /api/trade/{id}',
      progress: 'GET /api/progress',
      patterns: 'GET /api/patterns',
      execution_patterns: 'GET /api/execution-patterns'
    }
  });
};

const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

const validateTradingRules = (tradeData) => {
  const errors = [];

  if (tradeData.risk_amount > (parseFloat(process.env.MAX_RISK_PER_TRADE) || 50)) {
    errors.push({
      rule: 'MAX_RISK',
      message: `Risk amount $${tradeData.risk_amount} exceeds maximum $${process.env.MAX_RISK_PER_TRADE || 50} per trade`,
      severity: 'HIGH'
    });
  }

  const tradeTime = new Date(tradeData.timestamp);
  const hours = tradeTime.getHours();
  const minutes = tradeTime.getMinutes();
  const timeInMinutes = hours * 60 + minutes;
  const sessionStart = 9 * 60 + 30;
  const sessionEnd = 10 * 60 + 15;

  if (timeInMinutes < sessionStart || timeInMinutes > sessionEnd) {
    errors.push({
      rule: 'TRADING_HOURS',
      message: `Trade outside optimal session (9:30-10:15 AM EST)`,
      severity: 'MEDIUM'
    });
  }

  if (tradeData.risk_reward_ratio < 2.0) {
    errors.push({
      rule: 'RISK_REWARD',
      message: `Risk/reward ratio ${tradeData.risk_reward_ratio} below 2:1 minimum`,
      severity: 'MEDIUM'
    });
  }

  return {
    valid: errors.length === 0,
    errors: errors
  };
};

module.exports = {
  errorHandler,
  notFound,
  asyncHandler,
  validateTradingRules
};