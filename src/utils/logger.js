const fs = require('fs');
const path = require('path');

const logsDir = './logs';
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

class Logger {
  constructor() {
    this.logFile = path.join(logsDir, `ghost-journal-${new Date().toISOString().split('T')[0]}.log`);
  }

  formatMessage(level, message, meta = {}) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      message,
      ...meta
    };

    return JSON.stringify(logEntry);
  }

  writeLog(level, message, meta = {}) {
    const formattedMessage = this.formatMessage(level, message, meta);

    console.log(formattedMessage);

    try {
      fs.appendFileSync(this.logFile, formattedMessage + '\n');
    } catch (error) {
      console.error('Failed to write to log file:', error);
    }
  }

  info(message, meta = {}) {
    this.writeLog('INFO', message, meta);
  }

  warn(message, meta = {}) {
    this.writeLog('WARN', message, meta);
  }

  error(message, meta = {}) {
    this.writeLog('ERROR', message, meta);
  }

  debug(message, meta = {}) {
    if (process.env.NODE_ENV === 'development') {
      this.writeLog('DEBUG', message, meta);
    }
  }

  tradeAnalysis(tradeId, analysis, meta = {}) {
    this.info('Trade Analysis Completed', {
      trade_id: tradeId,
      pattern_type: analysis.pattern_type,
      setup_quality: analysis.setup_quality,
      recommendation: analysis.recommendation,
      risk_amount: analysis.risk_amount,
      within_limits: analysis.within_limits,
      ...meta
    });
  }

  riskViolation(tradeId, violation, meta = {}) {
    this.warn('Risk Management Violation', {
      trade_id: tradeId,
      violation_type: violation.rule,
      severity: violation.severity,
      message: violation.message,
      ...meta
    });
  }

  apiError(endpoint, error, meta = {}) {
    this.error('API Error', {
      endpoint,
      error_message: error.message,
      stack: error.stack,
      ...meta
    });
  }

  claudeApiCall(success, responseTime, meta = {}) {
    this.info('Claude API Call', {
      success,
      response_time_ms: responseTime,
      ...meta
    });
  }

  progressUpdate(weekNumber, year, balance, pnl, meta = {}) {
    this.info('Progress Update', {
      week_number: weekNumber,
      year,
      account_balance: balance,
      weekly_pnl: pnl,
      ...meta
    });
  }

  patternLearning(patternName, outcome, confidence, meta = {}) {
    this.info('Pattern Learning Update', {
      pattern_name: patternName,
      outcome,
      confidence_score: confidence,
      ...meta
    });
  }

  sessionStart() {
    this.info('Ghost Journal Backend Session Started', {
      pid: process.pid,
      node_version: process.version,
      environment: process.env.NODE_ENV || 'development',
      memory_usage: process.memoryUsage()
    });
  }

  sessionEnd(uptime) {
    this.info('Ghost Journal Backend Session Ended', {
      uptime_seconds: uptime,
      memory_usage: process.memoryUsage()
    });
  }

  cleanup() {
    const maxAge = 30 * 24 * 60 * 60 * 1000;

    try {
      const files = fs.readdirSync(logsDir);
      const now = Date.now();

      files.forEach(file => {
        if (file.endsWith('.log')) {
          const filePath = path.join(logsDir, file);
          const stats = fs.statSync(filePath);

          if (now - stats.mtime.getTime() > maxAge) {
            fs.unlinkSync(filePath);
            this.info(`Cleaned up old log file: ${file}`);
          }
        }
      });
    } catch (error) {
      this.error('Log cleanup failed', { error: error.message });
    }
  }
}

const logger = new Logger();

logger.cleanup();

module.exports = logger;