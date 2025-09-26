const express = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { getDatabase, getWeekNumber } = require('../models/database');

const router = express.Router();

router.get('/alerts',
  asyncHandler(async (req, res) => {
    const { acknowledged = false } = req.query;
    const db = getDatabase();

    try {
      const alerts = await getRiskAlerts(db, acknowledged === 'true');
      const summary = await getAlertsSummary(db);

      res.json({
        success: true,
        data: {
          alerts: alerts,
          summary: summary,
          active_count: alerts.filter(alert => !alert.acknowledged).length
        }
      });

    } catch (error) {
      console.error('Risk alerts error:', error);
      throw error;
    } finally {
      db.close();
    }
  })
);

router.post('/alerts/:alertId/acknowledge',
  asyncHandler(async (req, res) => {
    const { alertId } = req.params;
    const db = getDatabase();

    try {
      const result = await acknowledgeAlert(db, alertId);

      if (result.changes === 0) {
        return res.status(404).json({
          success: false,
          error: 'Alert not found'
        });
      }

      res.json({
        success: true,
        message: 'Alert acknowledged successfully'
      });

    } catch (error) {
      console.error('Alert acknowledgment error:', error);
      throw error;
    } finally {
      db.close();
    }
  })
);

router.get('/risk-check',
  asyncHandler(async (req, res) => {
    const db = getDatabase();
    const currentWeek = getWeekNumber(new Date());
    const currentYear = new Date().getFullYear();

    try {
      const riskAssessment = await performRiskCheck(db, currentWeek, currentYear);

      res.json({
        success: true,
        data: riskAssessment
      });

    } catch (error) {
      console.error('Risk check error:', error);
      throw error;
    } finally {
      db.close();
    }
  })
);

router.post('/risk-check/manual',
  asyncHandler(async (req, res) => {
    const { trade_data } = req.body;

    if (!trade_data) {
      return res.status(400).json({
        success: false,
        error: 'Trade data is required for risk assessment'
      });
    }

    const db = getDatabase();

    try {
      const assessment = await assessTradeRisk(db, trade_data);

      res.json({
        success: true,
        data: assessment
      });

    } catch (error) {
      console.error('Manual risk assessment error:', error);
      throw error;
    } finally {
      db.close();
    }
  })
);

router.get('/violations',
  asyncHandler(async (req, res) => {
    const { limit = 50 } = req.query;
    const db = getDatabase();

    try {
      const violations = await getRiskViolations(db, parseInt(limit));
      const analysis = await analyzeViolations(db);

      res.json({
        success: true,
        data: {
          violations: violations,
          analysis: analysis,
          recommendations: generateViolationRecommendations(analysis)
        }
      });

    } catch (error) {
      console.error('Risk violations error:', error);
      throw error;
    } finally {
      db.close();
    }
  })
);

const getRiskAlerts = (db, acknowledgedOnly) => {
  return new Promise((resolve, reject) => {
    const whereClause = acknowledgedOnly ? 'WHERE acknowledged = 1' : 'WHERE acknowledged = 0';

    db.all(`
      SELECT
        ra.*,
        t.pattern_type,
        t.setup_quality,
        t.risk_reward_ratio,
        t.timestamp as trade_timestamp
      FROM risk_alerts ra
      LEFT JOIN trades t ON ra.trade_id = t.id
      ${whereClause}
      ORDER BY ra.timestamp DESC
      LIMIT 100
    `, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
};

const getAlertsSummary = (db) => {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT
        alert_type,
        severity,
        COUNT(*) as count,
        COUNT(CASE WHEN acknowledged = 0 THEN 1 END) as unacknowledged_count
      FROM risk_alerts
      WHERE timestamp >= datetime('now', '-30 days')
      GROUP BY alert_type, severity
      ORDER BY count DESC
    `, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }

      const summary = {
        total_alerts_30_days: 0,
        unacknowledged_count: 0,
        by_type: {},
        by_severity: { HIGH: 0, MEDIUM: 0, LOW: 0 }
      };

      (rows || []).forEach(row => {
        summary.total_alerts_30_days += row.count;
        summary.unacknowledged_count += row.unacknowledged_count;
        summary.by_type[row.alert_type] = row.count;
        summary.by_severity[row.severity] += row.count;
      });

      resolve(summary);
    });
  });
};

const acknowledgeAlert = (db, alertId) => {
  return new Promise((resolve, reject) => {
    db.run(`
      UPDATE risk_alerts
      SET acknowledged = 1
      WHERE id = ?
    `, [alertId], function(err) {
      if (err) reject(err);
      else resolve({ changes: this.changes });
    });
  });
};

const performRiskCheck = (db, weekNumber, year) => {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT
        COUNT(*) as total_trades,
        COUNT(CASE WHEN executed = 1 THEN 1 END) as executed_trades,
        AVG(risk_amount) as avg_risk,
        MAX(risk_amount) as max_risk,
        COUNT(CASE WHEN within_limits = 0 THEN 1 END) as violations,
        SUM(CASE WHEN executed = 1 THEN actual_pnl END) as week_pnl,
        AVG(risk_reward_ratio) as avg_risk_reward
      FROM trades
      WHERE week_number = ? AND year = ?
    `, [weekNumber, year], (err, rows) => {
      if (err) {
        reject(err);
        return;
      }

      const data = rows[0] || {};

      db.get(`
        SELECT account_balance
        FROM progress
        WHERE week_number = ? AND year = ?
      `, [weekNumber, year], (err, balanceRow) => {
        if (err) {
          reject(err);
          return;
        }

        const currentBalance = balanceRow?.account_balance || 0;
        const assessment = generateRiskAssessment(data, currentBalance, weekNumber);

        resolve(assessment);
      });
    });
  });
};

const generateRiskAssessment = (tradeData, currentBalance, weekNumber) => {
  const maxRiskPerTrade = parseFloat(process.env.MAX_RISK_PER_TRADE) || 50;
  const maxTradesPerWeek = parseInt(process.env.MAX_TRADES_PER_WEEK) || 3;
  const targetWeeklyReturn = parseFloat(process.env.TARGET_WEEKLY_RETURN) || 0.0075;

  const riskScore = calculateRiskScore(tradeData, maxRiskPerTrade);
  const warnings = [];
  const recommendations = [];

  if (tradeData.violations > 0) {
    warnings.push(`${tradeData.violations} risk limit violations this week`);
    recommendations.push('Review position sizing methodology');
  }

  if (tradeData.total_trades >= maxTradesPerWeek) {
    warnings.push('Weekly trade frequency limit reached');
    recommendations.push('Focus on setup quality over quantity');
  }

  if (tradeData.avg_risk_reward < 2.0) {
    warnings.push(`Average R:R ratio ${tradeData.avg_risk_reward?.toFixed(1)} below 2:1 target`);
    recommendations.push('Improve target selection for better risk-reward ratios');
  }

  const weeklyProgress = ((tradeData.week_pnl || 0) / (currentBalance * targetWeeklyReturn)) * 100;

  return {
    week_number: weekNumber,
    risk_score: riskScore,
    status: riskScore > 7 ? 'HIGH_RISK' : riskScore > 4 ? 'MODERATE_RISK' : 'LOW_RISK',
    current_balance: currentBalance,
    weekly_statistics: {
      total_trades: tradeData.total_trades || 0,
      executed_trades: tradeData.executed_trades || 0,
      avg_risk_per_trade: Math.round((tradeData.avg_risk || 0) * 100) / 100,
      max_risk_taken: tradeData.max_risk || 0,
      rule_violations: tradeData.violations || 0,
      avg_risk_reward: Math.round((tradeData.avg_risk_reward || 0) * 10) / 10,
      weekly_pnl: Math.round((tradeData.week_pnl || 0) * 100) / 100,
      target_progress: `${Math.round(weeklyProgress)}%`
    },
    warnings: warnings,
    recommendations: recommendations,
    compliance_status: {
      risk_limits: tradeData.violations === 0,
      frequency_limits: tradeData.total_trades <= maxTradesPerWeek,
      session_timing: true,
      risk_reward_targets: (tradeData.avg_risk_reward || 0) >= 2.0
    }
  };
};

const calculateRiskScore = (tradeData, maxRisk) => {
  let score = 0;

  if (tradeData.violations > 0) score += tradeData.violations * 2;

  if ((tradeData.avg_risk || 0) > maxRisk * 0.8) score += 2;
  if ((tradeData.max_risk || 0) > maxRisk) score += 3;

  if ((tradeData.avg_risk_reward || 0) < 1.5) score += 2;
  if ((tradeData.avg_risk_reward || 0) < 1.0) score += 2;

  if (tradeData.total_trades > parseInt(process.env.MAX_TRADES_PER_WEEK) || 3) score += 1;

  return Math.min(10, score);
};

const assessTradeRisk = (db, tradeData) => {
  return new Promise((resolve, reject) => {
    const assessment = {
      trade_assessment: 'ANALYZING',
      risk_factors: [],
      recommendations: [],
      compliance_check: {},
      score: 0
    };

    const maxRisk = parseFloat(process.env.MAX_RISK_PER_TRADE) || 50;

    if (tradeData.risk_amount > maxRisk) {
      assessment.risk_factors.push({
        factor: 'RISK_AMOUNT_EXCEEDED',
        message: `Risk amount $${tradeData.risk_amount} exceeds $${maxRisk} limit`,
        severity: 'HIGH'
      });
      assessment.score += 5;
    }

    if (tradeData.risk_reward_ratio < 2.0) {
      assessment.risk_factors.push({
        factor: 'LOW_RISK_REWARD',
        message: `Risk-reward ratio ${tradeData.risk_reward_ratio} below 2:1 minimum`,
        severity: 'MEDIUM'
      });
      assessment.score += 2;
    }

    if (tradeData.setup_quality < 6) {
      assessment.risk_factors.push({
        factor: 'LOW_SETUP_QUALITY',
        message: `Setup quality ${tradeData.setup_quality}/10 below standards`,
        severity: 'MEDIUM'
      });
      assessment.score += 1;
    }

    const tradeTime = new Date(tradeData.timestamp);
    const hours = tradeTime.getHours();
    const minutes = tradeTime.getMinutes();
    const timeInMinutes = hours * 60 + minutes;

    if (timeInMinutes < (9 * 60 + 30) || timeInMinutes > (10 * 60 + 15)) {
      assessment.risk_factors.push({
        factor: 'OUTSIDE_OPTIMAL_HOURS',
        message: 'Trade outside optimal 9:30-10:15 AM EST window',
        severity: 'LOW'
      });
      assessment.score += 0.5;
    }

    if (assessment.score === 0) {
      assessment.trade_assessment = 'LOW_RISK';
      assessment.recommendations.push('Trade meets all risk management criteria');
    } else if (assessment.score <= 3) {
      assessment.trade_assessment = 'MODERATE_RISK';
      assessment.recommendations.push('Consider risk factors before execution');
    } else {
      assessment.trade_assessment = 'HIGH_RISK';
      assessment.recommendations.push('High risk - consider skipping this trade');
    }

    assessment.compliance_check = {
      risk_amount: tradeData.risk_amount <= maxRisk,
      risk_reward_ratio: tradeData.risk_reward_ratio >= 2.0,
      setup_quality: tradeData.setup_quality >= 6,
      timing: timeInMinutes >= (9 * 60 + 30) && timeInMinutes <= (10 * 60 + 15),
      overall_compliant: assessment.score <= 1
    };

    resolve(assessment);
  });
};

const getRiskViolations = (db, limit) => {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT
        t.*,
        ra.alert_type,
        ra.message as alert_message,
        ra.severity
      FROM trades t
      JOIN risk_alerts ra ON t.id = ra.trade_id
      WHERE t.within_limits = 0 OR ra.severity = 'HIGH'
      ORDER BY t.timestamp DESC
      LIMIT ?
    `, [limit], (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
};

const analyzeViolations = (db) => {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT
        alert_type,
        COUNT(*) as violation_count,
        AVG(t.risk_amount) as avg_risk_amount,
        AVG(t.setup_quality) as avg_setup_quality,
        strftime('%Y-%W', t.timestamp) as week,
        COUNT(DISTINCT strftime('%Y-%W', t.timestamp)) as weeks_affected
      FROM risk_alerts ra
      JOIN trades t ON ra.trade_id = t.id
      WHERE ra.severity IN ('HIGH', 'MEDIUM')
      AND t.timestamp >= datetime('now', '-90 days')
      GROUP BY alert_type
      ORDER BY violation_count DESC
    `, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }

      const analysis = {
        total_violations: 0,
        most_common_violation: null,
        violation_trend: 'stable',
        patterns: []
      };

      if (rows && rows.length > 0) {
        analysis.total_violations = rows.reduce((sum, row) => sum + row.violation_count, 0);
        analysis.most_common_violation = rows[0];

        analysis.patterns = rows.map(row => ({
          type: row.alert_type,
          count: row.violation_count,
          avg_risk_amount: Math.round((row.avg_risk_amount || 0) * 100) / 100,
          avg_setup_quality: Math.round((row.avg_setup_quality || 0) * 10) / 10,
          weeks_affected: row.weeks_affected
        }));
      }

      resolve(analysis);
    });
  });
};

const generateViolationRecommendations = (analysis) => {
  const recommendations = [];

  if (analysis.most_common_violation) {
    switch (analysis.most_common_violation.alert_type) {
      case 'MAX_RISK':
        recommendations.push('Implement stricter position sizing controls');
        recommendations.push('Consider using percentage-based risk instead of fixed dollar amounts');
        break;
      case 'TRADING_HOURS':
        recommendations.push('Set calendar alerts for optimal trading window (9:30-10:15 AM)');
        recommendations.push('Avoid emotional trading outside designated hours');
        break;
      case 'RISK_REWARD':
        recommendations.push('Improve target selection methodology');
        recommendations.push('Practice identifying better entry and exit points');
        break;
      default:
        recommendations.push('Review and strengthen risk management protocols');
    }
  }

  if (analysis.total_violations > 10) {
    recommendations.push('Consider taking a trading break to review risk management approach');
  }

  if (analysis.patterns.length > 3) {
    recommendations.push('Multiple violation types suggest need for comprehensive risk system review');
  }

  return recommendations;
};

module.exports = router;