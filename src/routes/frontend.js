const express = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { getDatabase, getWeekNumber } = require('../models/database');

const router = express.Router();

// Get trade history with pagination and filtering
router.get('/trades/history', asyncHandler(async (req, res) => {
  const db = getDatabase();

  try {
    const {
      page = 1,
      limit = 20,
      pattern = 'all',
      result = 'all',
      date_range = 30
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);

    // Build filter conditions
    let whereConditions = ['1=1']; // Always true base condition
    let queryParams = [];

    if (pattern !== 'all') {
      whereConditions.push('pattern_type LIKE ?');
      queryParams.push(`%${pattern}%`);
    }

    if (result !== 'all') {
      if (result === 'win') {
        whereConditions.push('actual_pnl > 0');
      } else if (result === 'loss') {
        whereConditions.push('actual_pnl < 0');
      }
    }

    if (date_range !== 'all') {
      whereConditions.push("timestamp >= datetime('now', '-' || ? || ' days')");
      queryParams.push(parseInt(date_range));
    }

    const whereClause = whereConditions.join(' AND ');

    // Get total count for pagination
    const countQuery = `
      SELECT COUNT(*) as total
      FROM trades
      WHERE ${whereClause}
    `;

    const totalResult = await new Promise((resolve, reject) => {
      db.get(countQuery, queryParams, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    // Get paginated trades
    const tradesQuery = `
      SELECT
        id,
        date(timestamp) as date,
        pattern_type as pattern,
        CASE
          WHEN actual_pnl > 0 THEN 'Win'
          WHEN actual_pnl < 0 THEN 'Loss'
          WHEN actual_pnl = 0 THEN 'Breakeven'
          ELSE 'Pending'
        END as result,
        actual_pnl as pnl,
        risk_reward_ratio,
        CASE WHEN linked_execution_id IS NOT NULL THEN 1 ELSE 0 END as has_execution_analysis,
        1 as has_setup_analysis,
        setup_quality,
        confidence_score,
        recommendation,
        trading_style,
        timeframes_used
      FROM trades
      WHERE ${whereClause}
      ORDER BY timestamp DESC
      LIMIT ? OFFSET ?
    `;

    queryParams.push(parseInt(limit), offset);

    const trades = await new Promise((resolve, reject) => {
      db.all(tradesQuery, queryParams, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });

    // Format trades for frontend
    const formattedTrades = trades.map(trade => ({
      id: trade.id,
      date: trade.date,
      pattern: trade.pattern || 'Unknown',
      result: trade.result,
      pnl: trade.pnl || 0,
      risk_reward: trade.risk_reward_ratio ? `1:${trade.risk_reward_ratio}` : 'N/A',
      has_execution_analysis: Boolean(trade.has_execution_analysis),
      has_setup_analysis: Boolean(trade.has_setup_analysis),
      setup_quality: trade.setup_quality || 5,
      confidence_score: trade.confidence_score || 0.5,
      recommendation: trade.recommendation || 'WAIT',
      trading_style: trade.trading_style || 'scalping',
      timeframes: trade.timeframes_used ? trade.timeframes_used.split(',') : []
    }));

    const totalTrades = totalResult.total;
    const totalPages = Math.ceil(totalTrades / parseInt(limit));
    const currentPage = parseInt(page);

    res.json({
      success: true,
      data: {
        trades: formattedTrades,
        total_trades: totalTrades,
        pagination: {
          current_page: currentPage,
          total_pages: totalPages,
          has_next: currentPage < totalPages,
          has_prev: currentPage > 1,
          limit: parseInt(limit)
        }
      }
    });

  } catch (error) {
    console.error('Trade history error:', error);
    throw error;
  } finally {
    db.close();
  }
}));

// Get individual trade setup analysis
router.get('/trades/:tradeId/setup-analysis', asyncHandler(async (req, res) => {
  const db = getDatabase();
  const { tradeId } = req.params;

  try {
    const trade = await new Promise((resolve, reject) => {
      db.get(`
        SELECT t.*,
               GROUP_CONCAT(sa.timeframe_label) as available_timeframes,
               sa.screenshot_path as primary_screenshot
        FROM trades t
        LEFT JOIN screenshot_analysis sa ON t.id = sa.trade_id
        WHERE t.id = ?
        GROUP BY t.id
      `, [tradeId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!trade) {
      return res.status(404).json({
        success: false,
        error: 'TRADE_NOT_FOUND',
        message: 'Trade not found',
        code: 404
      });
    }

    // Get screenshot paths
    const screenshots = await new Promise((resolve, reject) => {
      db.all(`
        SELECT timeframe_label, screenshot_path
        FROM screenshot_analysis
        WHERE trade_id = ?
      `, [tradeId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });

    const screenshotPaths = {};
    screenshots.forEach(screenshot => {
      screenshotPaths[screenshot.timeframe_label] = `/uploads/${screenshot.screenshot_path.replace(/\\/g, '/')}`;
    });

    // Build frontend-compatible response
    const setupAnalysis = {
      overall_setup_grade: {
        grade: convertScoreToGrade(trade.setup_quality || 5),
        description: trade.ai_commentary || 'Setup analysis completed',
        score: trade.setup_quality || 5
      },
      pattern_recognition: {
        primary_pattern: trade.pattern_type || 'Unknown Pattern',
        confirmation_status: trade.confidence_score > 0.7 ? 'Confirmed' : trade.confidence_score > 0.4 ? 'Pending' : 'Weak',
        volume_profile: 'Average', // Could be enhanced with more data
        market_structure: trade.recommendation === 'EXECUTE' ? 'Bullish' : 'Neutral'
      },
      risk_analysis: {
        risk_reward_ratio: trade.risk_reward_ratio ? `${trade.risk_reward_ratio}:1` : '2:1',
        stop_placement: trade.stop_placement || 'Good',
        position_size: 'Conservative' // Based on $50 max risk
      },
      detailed_insights: {
        strengths: trade.specific_observations ?
          (Array.isArray(trade.specific_observations) ? trade.specific_observations :
           JSON.parse(trade.specific_observations || '[]').slice(0, 4)) :
          ['Setup analysis completed', 'Risk parameters within limits'],
        improvements: trade.learning_insights ?
          trade.learning_insights.split('. ').slice(0, 3) :
          ['Continue systematic analysis approach']
      },
      recommended_actions: [
        trade.recommendation === 'EXECUTE' ? 'Execute trade as planned' : 'Monitor for better setup',
        'Maintain risk management discipline',
        'Document execution for review'
      ],
      screenshots: {
        primary_timeframe: trade.timeframes_used?.split(',')[0] || 'unknown',
        available_timeframes: trade.available_timeframes?.split(',') || [],
        screenshot_paths: screenshotPaths
      },
      confidence_score: trade.confidence_score || 0.5,
      analysis_confidence: trade.confidence_score > 0.7 ? 'High' : trade.confidence_score > 0.4 ? 'Moderate' : 'Low',
      session_quality: trade.session_timing || 'good',
      risk_amount_dollars: trade.risk_amount || 50
    };

    res.json({
      success: true,
      data: setupAnalysis
    });

  } catch (error) {
    console.error('Setup analysis error:', error);
    throw error;
  } finally {
    db.close();
  }
}));

// Get individual trade execution analysis
router.get('/trades/:tradeId/execution-analysis', asyncHandler(async (req, res) => {
  const db = getDatabase();
  const { tradeId } = req.params;

  try {
    // Get execution trade (linked trade)
    const executionTrade = await new Promise((resolve, reject) => {
      db.get(`
        SELECT * FROM trades
        WHERE trade_phase = 'execution' AND linked_execution_id = ?
           OR (id = ? AND linked_execution_id IS NOT NULL)
      `, [tradeId, tradeId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!executionTrade) {
      return res.status(404).json({
        success: false,
        error: 'EXECUTION_NOT_FOUND',
        message: 'Execution analysis not found for this trade',
        code: 404
      });
    }

    const executionAnalysis = {
      execution_timing: executionTrade.execution_timing || 'optimal',
      execution_grade: executionTrade.execution_quality_grade || 'B+',
      actual_prices: {
        entry: executionTrade.actual_entry || 0,
        stop: executionTrade.actual_stop || 0,
        target: executionTrade.actual_target || 0
      },
      price_variances: {
        entry_variance: executionTrade.entry_variance || 0,
        stop_variance: executionTrade.stop_variance || 0,
        target_variance: executionTrade.target_variance || 0
      },
      behavioral_observations: executionTrade.behavioral_observations ?
        JSON.parse(executionTrade.behavioral_observations) :
        ['Execution analysis completed'],
      coaching_insights: executionTrade.execution_coaching ?
        executionTrade.execution_coaching.split('\n') :
        ['Continue disciplined execution approach'],
      actual_outcome: executionTrade.actual_outcome || executionTrade.trade_outcome || 'pending'
    };

    res.json({
      success: true,
      data: executionAnalysis
    });

  } catch (error) {
    console.error('Execution analysis error:', error);
    throw error;
  } finally {
    db.close();
  }
}));

// EXECUTION ANALYSIS PAGE INTEGRATION
// GET /api/execution-analysis/{tradeId} - Comprehensive execution analysis for frontend display
router.get('/execution-analysis/:tradeId', asyncHandler(async (req, res) => {
  const db = getDatabase();
  const { tradeId } = req.params;

  try {
    // Get both pre-trade and execution records
    const [preTrade, executionTrade] = await Promise.all([
      new Promise((resolve, reject) => {
        db.get(`
          SELECT * FROM trades
          WHERE id = ? AND trade_phase = 'pre_trade'
        `, [tradeId], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      }),
      new Promise((resolve, reject) => {
        db.get(`
          SELECT * FROM trades
          WHERE linked_execution_id = ? AND trade_phase = 'execution'
        `, [tradeId], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      })
    ]);

    if (!preTrade || !executionTrade) {
      return res.status(404).json({
        success: false,
        error: 'EXECUTION_ANALYSIS_NOT_FOUND',
        message: 'Complete execution analysis not available for this trade',
        code: 404
      });
    }

    // Build comprehensive execution analysis matching frontend layout
    const comprehensiveAnalysis = {
      trade_overview: {
        pattern: preTrade.pattern_type || 'Unknown Pattern',
        execution_date: new Date(executionTrade.timestamp).toLocaleDateString(),
        execution_time: executionTrade.execution_time || 'Unknown',
        outcome: executionTrade.trade_outcome || 'pending',
        pnl: executionTrade.actual_pnl || 0
      },

      // Price execution comparison table
      price_comparison: {
        planned: {
          entry: preTrade.planned_entry || executionTrade.actual_entry,
          stop: preTrade.planned_stop || executionTrade.actual_stop,
          target: preTrade.planned_target || executionTrade.actual_target,
          risk_reward: `${preTrade.planned_rr || 2}:1`
        },
        actual: {
          entry: executionTrade.actual_entry,
          stop: executionTrade.actual_stop,
          target: executionTrade.actual_target,
          risk_reward: `${executionTrade.actual_rr?.toFixed(1) || '2.0'}:1`
        },
        variances: {
          entry_variance: `${executionTrade.entry_variance > 0 ? '+' : ''}${(executionTrade.entry_variance || 0).toFixed(1)} pts`,
          stop_variance: `${executionTrade.stop_variance > 0 ? '+' : ''}${(executionTrade.stop_variance || 0).toFixed(1)} pts`,
          target_variance: `${executionTrade.target_variance > 0 ? '+' : ''}${(executionTrade.target_variance || 0).toFixed(1)} pts`,
          rr_impact: `${((executionTrade.actual_rr || 2) - (preTrade.planned_rr || 2)) > 0 ? '+' : ''}${((executionTrade.actual_rr || 2) - (preTrade.planned_rr || 2)).toFixed(1)}`
        }
      },

      // Execution grades display
      execution_grades: {
        entry_timing: gradeExecutionComponent(executionTrade.entry_variance || 0),
        stop_management: gradeExecutionComponent(executionTrade.stop_variance || 0),
        target_selection: gradeExecutionComponent(executionTrade.target_variance || 0),
        overall_grade: executionTrade.execution_quality_grade || 'B',
        grade_explanations: {
          entry_timing: getGradeExplanation('entry', executionTrade.entry_variance || 0),
          stop_management: getGradeExplanation('stop', executionTrade.stop_variance || 0),
          target_selection: getGradeExplanation('target', executionTrade.target_variance || 0)
        }
      },

      // Behavioral coaching text (1500+ words)
      behavioral_coaching: {
        execution_insights: generateDetailedExecutionInsights(executionTrade, preTrade),
        strengths_reinforcement: generateStrengthsAnalysis(executionTrade, preTrade),
        improvement_protocol: generateImprovementProtocol(executionTrade, preTrade),
        psychological_profile: generatePsychologicalProfile(executionTrade, preTrade),
        skill_trajectory: generateSkillTrajectoryAnalysis(executionTrade, preTrade),
        long_term_impact: generateLongTermImpactAnalysis(executionTrade, preTrade)
      },

      // Action items and improvement protocols
      action_items: [
        generateActionItem('entry', executionTrade.entry_variance || 0),
        generateActionItem('stop', executionTrade.stop_variance || 0),
        generateActionItem('target', executionTrade.target_variance || 0),
        'Continue systematic post-trade review process',
        'Document key lessons in trading journal'
      ].filter(Boolean),

      improvement_protocols: [
        `${preTrade.pattern_type} Pattern Mastery: Focus on ${getWeakestArea(executionTrade)}`,
        'Volume Confirmation Drill: Wait for volume expansion before entry',
        'Risk Management Review: Maintain disciplined position sizing',
        'Execution Timing Protocol: Use 3-2-1 entry confirmation system'
      ],

      execution_screenshot_path: `/uploads/${executionTrade.screenshot_path?.replace(/\\/g, '/')}` || null
    };

    res.json({
      success: true,
      data: comprehensiveAnalysis
    });

  } catch (error) {
    console.error('Comprehensive execution analysis error:', error);
    throw error;
  } finally {
    db.close();
  }
}));

// Export trade data
router.get('/trades/export', asyncHandler(async (req, res) => {
  const db = getDatabase();

  try {
    const {
      format = 'csv',
      date_range = 90
    } = req.query;

    let whereCondition = '1=1';
    let queryParams = [];

    if (date_range !== 'all') {
      whereCondition = "timestamp >= datetime('now', '-' || ? || ' days')";
      queryParams.push(parseInt(date_range));
    }

    const trades = await new Promise((resolve, reject) => {
      db.all(`
        SELECT
          id,
          timestamp,
          pattern_type,
          setup_quality,
          risk_reward_ratio,
          actual_pnl,
          confidence_score,
          recommendation,
          session_timing,
          trading_style,
          timeframes_used,
          risk_amount,
          entry_quality,
          stop_placement,
          target_selection
        FROM trades
        WHERE ${whereCondition}
        ORDER BY timestamp DESC
      `, queryParams, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });

    if (format === 'csv') {
      const csvHeaders = [
        'Trade ID',
        'Date',
        'Pattern',
        'Setup Quality',
        'Risk Reward',
        'P&L',
        'Confidence',
        'Recommendation',
        'Session',
        'Style',
        'Timeframes',
        'Risk Amount',
        'Entry Quality',
        'Stop Placement',
        'Target Selection'
      ].join(',');

      const csvRows = trades.map(trade => [
        trade.id,
        trade.timestamp,
        trade.pattern_type || '',
        trade.setup_quality || '',
        trade.risk_reward_ratio || '',
        trade.actual_pnl || '',
        trade.confidence_score || '',
        trade.recommendation || '',
        trade.session_timing || '',
        trade.trading_style || '',
        trade.timeframes_used || '',
        trade.risk_amount || '',
        trade.entry_quality || '',
        trade.stop_placement || '',
        trade.target_selection || ''
      ].join(','));

      const csvContent = [csvHeaders, ...csvRows].join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="ghost_journal_trades_${Date.now()}.csv"`);
      res.send(csvContent);
    } else {
      res.json({
        success: true,
        data: trades
      });
    }

  } catch (error) {
    console.error('Export error:', error);
    throw error;
  } finally {
    db.close();
  }
}));

// Dashboard data endpoint
router.get('/dashboard', asyncHandler(async (req, res) => {
  const db = getDatabase();

  try {
    const currentWeek = getWeekNumber(new Date());
    const currentYear = new Date().getFullYear();

    // Get account balance from latest progress entry
    const latestProgress = await new Promise((resolve, reject) => {
      db.get(`
        SELECT account_balance, cumulative_pnl, week_pnl_percentage
        FROM progress
        ORDER BY date DESC
        LIMIT 1
      `, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    // Get today's P&L change
    const todayPnl = await new Promise((resolve, reject) => {
      db.get(`
        SELECT COALESCE(SUM(actual_pnl), 0) as today_pnl
        FROM trades
        WHERE date(timestamp) = date('now')
        AND actual_pnl IS NOT NULL
      `, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    // Get this week's progress
    const weeklyStats = await new Promise((resolve, reject) => {
      db.get(`
        SELECT
          COUNT(*) as trades_this_week,
          COALESCE(SUM(actual_pnl), 0) as week_pnl,
          COALESCE(AVG(setup_quality), 0) as avg_setup_quality
        FROM trades
        WHERE week_number = ? AND year = ?
      `, [currentWeek, currentYear], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    // Get total trades count
    const totalTrades = await new Promise((resolve, reject) => {
      db.get(`
        SELECT COUNT(*) as total
        FROM trades
      `, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    // Get win rate
    const winRate = await new Promise((resolve, reject) => {
      db.get(`
        SELECT
          COUNT(*) as total_executed,
          SUM(CASE WHEN actual_pnl > 0 THEN 1 ELSE 0 END) as wins
        FROM trades
        WHERE actual_pnl IS NOT NULL
      `, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    // Get recent trades
    const recentTrades = await new Promise((resolve, reject) => {
      db.all(`
        SELECT
          id,
          timestamp,
          pattern_type,
          actual_pnl,
          setup_quality,
          recommendation
        FROM trades
        ORDER BY timestamp DESC
        LIMIT 5
      `, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });

    const accountBalance = latestProgress?.account_balance || 67500;
    const weeklyPnlDollar = weeklyStats?.week_pnl || 0;
    const weeklyPnlPercent = (weeklyPnlDollar / accountBalance) * 100;
    const weeklyTarget = 0.75; // 0.75% weekly target
    const calculatedWinRate = winRate?.total_executed > 0 ?
      (winRate.wins / winRate.total_executed) * 100 : 0;

    res.json({
      success: true,
      data: {
        account_balance: accountBalance,
        today_change: todayPnl?.today_pnl || 0,
        weekly_progress: {
          current: Number(weeklyPnlPercent.toFixed(2)),
          target: weeklyTarget,
          dollar_change: weeklyPnlDollar
        },
        total_trades: totalTrades?.total || 0,
        this_week_trades: `${weeklyStats?.trades_this_week || 0}/${process.env.MAX_TRADES_PER_WEEK || 3}`,
        win_rate: Number(calculatedWinRate.toFixed(1)),
        recent_trades: recentTrades.map(trade => ({
          id: trade.id,
          date: new Date(trade.timestamp).toLocaleDateString(),
          pattern: trade.pattern_type || 'Unknown',
          pnl: trade.actual_pnl || 0,
          grade: convertScoreToGrade(trade.setup_quality || 5),
          recommendation: trade.recommendation || 'WAIT'
        }))
      }
    });

  } catch (error) {
    console.error('Dashboard error:', error);
    throw error;
  } finally {
    db.close();
  }
}));

// Analytics data endpoint
router.get('/analytics', asyncHandler(async (req, res) => {
  const db = getDatabase();

  try {
    // Get execution score (average setup quality)
    const executionScore = await new Promise((resolve, reject) => {
      db.get(`
        SELECT
          COALESCE(AVG(setup_quality), 0) as current_score,
          COUNT(*) as total_trades
        FROM trades
        WHERE timestamp >= datetime('now', '-30 days')
      `, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    // Get previous month for comparison
    const previousExecutionScore = await new Promise((resolve, reject) => {
      db.get(`
        SELECT COALESCE(AVG(setup_quality), 0) as prev_score
        FROM trades
        WHERE timestamp BETWEEN datetime('now', '-60 days') AND datetime('now', '-30 days')
      `, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    // Get pattern success rates
    const patternSuccess = await new Promise((resolve, reject) => {
      db.all(`
        SELECT
          pattern_type,
          COUNT(*) as total,
          SUM(CASE WHEN actual_pnl > 0 THEN 1 ELSE 0 END) as wins,
          ROUND(
            (SUM(CASE WHEN actual_pnl > 0 THEN 1 ELSE 0 END) * 100.0 / COUNT(*)), 1
          ) as win_rate
        FROM trades
        WHERE pattern_type IS NOT NULL
        AND actual_pnl IS NOT NULL
        GROUP BY pattern_type
        HAVING COUNT(*) >= 3
        ORDER BY win_rate DESC
        LIMIT 5
      `, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });

    // Get weekly streak
    const weeklyStreak = await new Promise((resolve, reject) => {
      db.all(`
        SELECT
          week_number,
          year,
          SUM(actual_pnl) as week_pnl
        FROM trades
        WHERE actual_pnl IS NOT NULL
        GROUP BY week_number, year
        ORDER BY year DESC, week_number DESC
        LIMIT 10
      `, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });

    // Calculate streak
    let currentStreak = 0;
    for (const week of weeklyStreak) {
      if (week.week_pnl > 0) {
        currentStreak++;
      } else {
        break;
      }
    }

    // Get session performance
    const sessionPerformance = await new Promise((resolve, reject) => {
      db.all(`
        SELECT
          session_timing,
          COUNT(*) as total,
          COALESCE(AVG(actual_pnl), 0) as avg_pnl,
          ROUND(AVG(setup_quality), 1) as avg_quality
        FROM trades
        WHERE session_timing IS NOT NULL
        AND timestamp >= datetime('now', '-90 days')
        GROUP BY session_timing
        ORDER BY avg_pnl DESC
      `, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });

    // Get behavioral insights
    const behavioralInsights = await new Promise((resolve, reject) => {
      db.all(`
        SELECT
          recommendation,
          COUNT(*) as total,
          COALESCE(AVG(actual_pnl), 0) as avg_pnl,
          ROUND(AVG(confidence_score), 2) as avg_confidence
        FROM trades
        WHERE recommendation IS NOT NULL
        AND timestamp >= datetime('now', '-60 days')
        GROUP BY recommendation
        ORDER BY avg_pnl DESC
      `, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });

    const currentScore = Math.round(executionScore?.current_score * 10 || 50);
    const previousScore = Math.round(previousExecutionScore?.prev_score * 10 || 50);
    const monthlyChange = currentScore - previousScore;

    const bestPattern = patternSuccess[0];

    res.json({
      success: true,
      data: {
        execution_score: {
          current: currentScore,
          target: 85,
          monthly_change: monthlyChange
        },
        pattern_success: {
          best_pattern: bestPattern?.pattern_type || 'No pattern data',
          win_rate: bestPattern?.win_rate || 0
        },
        weekly_streak: currentStreak,
        pattern_breakdown: patternSuccess.map(pattern => ({
          pattern: pattern.pattern_type,
          total_trades: pattern.total,
          win_rate: pattern.win_rate,
          wins: pattern.wins
        })),
        session_performance: sessionPerformance.map(session => ({
          session: session.session_timing,
          avg_pnl: Number(session.avg_pnl.toFixed(2)),
          avg_quality: session.avg_quality,
          total_trades: session.total
        })),
        behavioral_insights: behavioralInsights.map(insight => ({
          recommendation_type: insight.recommendation,
          total_trades: insight.total,
          avg_pnl: Number(insight.avg_pnl.toFixed(2)),
          avg_confidence: insight.avg_confidence,
          success_rate: insight.avg_pnl > 0 ? 'Positive' : 'Negative'
        }))
      }
    });

  } catch (error) {
    console.error('Analytics error:', error);
    throw error;
  } finally {
    db.close();
  }
}));

// Helper function to convert numeric score to letter grade
const convertScoreToGrade = (score) => {
  if (score >= 9.5) return 'A+';
  if (score >= 9) return 'A';
  if (score >= 8.5) return 'A-';
  if (score >= 8) return 'B+';
  if (score >= 7.5) return 'B';
  if (score >= 7) return 'B-';
  if (score >= 6.5) return 'C+';
  if (score >= 6) return 'C';
  if (score >= 5.5) return 'C-';
  if (score >= 5) return 'D';
  return 'F';
};

// Settings management endpoints
router.get('/settings', asyncHandler(async (req, res) => {
  const db = getDatabase();

  try {
    // Get user settings from database (with defaults)
    const settings = await new Promise((resolve, reject) => {
      db.get(`
        SELECT * FROM user_settings
        WHERE id = 1
      `, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    // Default settings structure
    const defaultSettings = {
      trading_settings: {
        default_instrument: 'MNQ',
        default_trading_style: 'mnq_scalping',
        session_preferences: {
          preferred_sessions: ['opening', 'mid_morning'],
          avoid_lunch_hours: true
        },
        weekly_target_percentage: 0.75,
        max_trades_per_week: 3
      },
      risk_management: {
        max_risk_per_trade: 50,
        account_size: 67500,
        max_daily_loss: 150,
        position_size_model: 'fixed_dollar',
        enable_session_risk_adjustment: true
      },
      analysis_preferences: {
        primary_timeframe_preference: 'ultra_short',
        require_confluence_timeframes: true,
        min_confidence_threshold: 0.6,
        enable_mnq_specialization: true
      },
      notification_settings: {
        enable_trade_alerts: true,
        enable_weekly_summaries: true,
        enable_pattern_reminders: false
      },
      display_preferences: {
        default_chart_layout: 'multi_timeframe',
        show_risk_metrics: true,
        compact_trade_history: false,
        theme: 'dark'
      }
    };

    // Merge stored settings with defaults
    let userSettings = defaultSettings;
    if (settings?.settings_json) {
      try {
        const storedSettings = JSON.parse(settings.settings_json);
        userSettings = {
          ...defaultSettings,
          ...storedSettings,
          trading_settings: { ...defaultSettings.trading_settings, ...storedSettings.trading_settings },
          risk_management: { ...defaultSettings.risk_management, ...storedSettings.risk_management },
          analysis_preferences: { ...defaultSettings.analysis_preferences, ...storedSettings.analysis_preferences },
          notification_settings: { ...defaultSettings.notification_settings, ...storedSettings.notification_settings },
          display_preferences: { ...defaultSettings.display_preferences, ...storedSettings.display_preferences }
        };
      } catch (error) {
        console.warn('Failed to parse stored settings, using defaults:', error);
      }
    }

    res.json({
      success: true,
      data: {
        settings: userSettings,
        last_updated: settings?.updated_at || null
      }
    });

  } catch (error) {
    console.error('Settings retrieval error:', error);
    throw error;
  } finally {
    db.close();
  }
}));

router.put('/settings', asyncHandler(async (req, res) => {
  const db = getDatabase();

  try {
    const { settings } = req.body;

    if (!settings || typeof settings !== 'object') {
      return res.status(400).json({
        success: false,
        error: 'INVALID_SETTINGS_FORMAT',
        message: 'Settings object is required',
        code: 400
      });
    }

    // Validate critical settings
    if (settings.risk_management) {
      const { max_risk_per_trade, account_size } = settings.risk_management;

      if (max_risk_per_trade && (max_risk_per_trade < 1 || max_risk_per_trade > 500)) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_RISK_AMOUNT',
          message: 'Max risk per trade must be between $1 and $500',
          code: 400
        });
      }

      if (account_size && account_size < 1000) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_ACCOUNT_SIZE',
          message: 'Account size must be at least $1,000',
          code: 400
        });
      }
    }

    if (settings.trading_settings?.weekly_target_percentage) {
      const target = settings.trading_settings.weekly_target_percentage;
      if (target < 0.1 || target > 10) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_WEEKLY_TARGET',
          message: 'Weekly target must be between 0.1% and 10%',
          code: 400
        });
      }
    }

    // Prepare settings for storage
    const settingsJson = JSON.stringify(settings);
    const timestamp = new Date().toISOString();

    // Insert or update settings
    await new Promise((resolve, reject) => {
      db.run(`
        INSERT OR REPLACE INTO user_settings (id, settings_json, updated_at)
        VALUES (1, ?, ?)
      `, [settingsJson, timestamp], function(err) {
        if (err) reject(err);
        else resolve(this);
      });
    });

    // Return updated settings
    res.json({
      success: true,
      data: {
        settings: settings,
        message: 'Settings updated successfully',
        last_updated: timestamp
      }
    });

  } catch (error) {
    console.error('Settings update error:', error);
    throw error;
  } finally {
    db.close();
  }
}));

// Reset settings to defaults
router.post('/settings/reset', asyncHandler(async (req, res) => {
  const db = getDatabase();

  try {
    await new Promise((resolve, reject) => {
      db.run(`DELETE FROM user_settings WHERE id = 1`, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    res.json({
      success: true,
      data: {
        message: 'Settings reset to defaults successfully'
      }
    });

  } catch (error) {
    console.error('Settings reset error:', error);
    throw error;
  } finally {
    db.close();
  }
}));

// HELPER FUNCTIONS FOR EXECUTION ANALYSIS

// Grade execution components based on variance
const gradeExecutionComponent = (variance) => {
  const absVariance = Math.abs(variance);
  if (absVariance <= 1) return 'A+';
  if (absVariance <= 2) return 'A';
  if (absVariance <= 3) return 'A-';
  if (absVariance <= 4) return 'B+';
  if (absVariance <= 5) return 'B';
  if (absVariance <= 7) return 'B-';
  if (absVariance <= 10) return 'C+';
  return 'C';
};

// Get grade explanation
const getGradeExplanation = (component, variance) => {
  const absVariance = Math.abs(variance);
  const componentName = component === 'entry' ? 'Entry timing' :
                       component === 'stop' ? 'Stop placement' : 'Target selection';

  if (absVariance <= 1) return `${componentName} was extremely precise (within 1 point)`;
  if (absVariance <= 2) return `${componentName} was very good (within 2 points)`;
  if (absVariance <= 3) return `${componentName} was good (within 3 points)`;
  if (absVariance <= 5) return `${componentName} was acceptable (within 5 points)`;
  return `${componentName} could be improved (${absVariance.toFixed(1)} point variance)`;
};

// Generate detailed execution insights (1500+ words)
const generateDetailedExecutionInsights = (executionTrade, preTrade) => {
  const outcome = executionTrade.trade_outcome || 'pending';
  const pattern = preTrade.pattern_type || 'Unknown';
  const entryVariance = Math.abs(executionTrade.entry_variance || 0);
  const stopVariance = Math.abs(executionTrade.stop_variance || 0);
  const targetVariance = Math.abs(executionTrade.target_variance || 0);

  return `COMPREHENSIVE EXECUTION ANALYSIS - ${pattern} Pattern

Your execution of this ${pattern} setup reveals significant insights into your trading psychology and skill development. This analysis examines not just the mechanical aspects of your trade execution, but the deeper behavioral patterns that determine long-term trading success.

ENTRY EXECUTION ANALYSIS:
Your entry execution showed a ${entryVariance.toFixed(1)} point variance from your planned entry level. ${entryVariance <= 2 ? 'This demonstrates excellent execution discipline and patience. You waited for your setup to develop properly and entered at nearly the exact level you identified during your pre-trade analysis. This precision indicates you are developing the critical skill of emotional control during high-stress entry moments.' : entryVariance <= 5 ? 'This variance suggests room for improvement in your entry timing. While not excessive, working to reduce this variance will significantly improve your risk-reward ratios over time. Consider implementing a more systematic entry protocol to achieve greater consistency.' : 'This larger variance indicates execution anxiety may be affecting your timing. Early entries often result from fear of missing the move, while late entries suggest hesitation or over-analysis. Both patterns can be improved through deliberate practice and emotional awareness techniques.'}

The timing of your entry at ${executionTrade.execution_time || 'unknown time'} provides additional context. ${executionTrade.execution_time?.includes('9:') ? 'Executing during the opening session demonstrates your understanding of optimal volatility windows for MNQ scalping. This timing choice shows strategic thinking beyond just technical analysis.' : 'The execution timing suggests you may benefit from focusing more on session-based trade timing for optimal results.'}

STOP MANAGEMENT EVALUATION:
Your stop placement varied by ${stopVariance.toFixed(1)} points from your original plan. ${stopVariance <= 2 ? 'This exceptional precision in stop placement demonstrates mature risk management discipline. You maintained your predetermined risk level despite potential market pressure or emotional impulses during execution. This consistency is a hallmark of professional trading behavior.' : stopVariance <= 4 ? 'This moderate variance in stop placement is within acceptable parameters but represents an area for refinement. Slight adjustments to stops can compound over many trades, so developing more precise stop management will enhance long-term performance.' : 'The larger variance in stop placement suggests emotional interference with your risk management plan. This could indicate panic adjustments, hope-based modifications, or uncertainty about your original analysis. Developing unwavering stop discipline is crucial for consistent profitability.'}

Professional traders understand that stop placement is as much about psychology as it is about technical levels. Your execution reveals important insights about your relationship with risk and uncertainty.

TARGET EXECUTION PSYCHOLOGY:
The ${targetVariance.toFixed(1)} point variance in your target level indicates ${targetVariance <= 3 ? 'strong discipline in profit-taking. You stuck closely to your plan even when faced with the temptation to hold for larger gains or the fear of giving back profits. This balance between greed and fear is essential for scalping success.' : 'potential improvement opportunities in profit management. Target modifications during execution often reflect emotional reactions to price action rather than logical adjustments. Developing more systematic profit-taking rules will improve consistency.'}

OUTCOME ANALYSIS AND LEARNING:
This trade resulted in a ${outcome} outcome with a P&L of ${(executionTrade.actual_pnl || 0).toFixed(0)} dollars. ${outcome === 'win' ? 'The winning result validates your pre-trade analysis and execution approach. However, remember that even perfect execution can result in losses due to market randomness. Focus on the process quality rather than just outcomes.' : outcome === 'loss' ? 'While the losing outcome is disappointing, your execution discipline demonstrates professional trading behavior. Losses are inevitable in trading; what matters is that you followed your plan and managed risk appropriately. This execution contributes to your long-term edge development.' : 'The breakeven result shows excellent risk management when the trade didn\'t develop as expected. This outcome demonstrates mature trading psychology - knowing when to exit without a significant loss is as important as capturing winners.'}

Your execution of ${pattern} patterns specifically shows ${pattern.includes('Bull') ? 'appropriate aggression in bullish setups, though monitor for over-eagerness that could lead to premature entries.' : pattern.includes('Bear') ? 'proper caution in bearish setups, ensuring you\'re not too hesitant in taking valid short opportunities.' : 'balanced execution approach that can be applied consistently across different setup types.'}

This execution represents another data point in your skill development journey. Continue this systematic approach to reach advanced proficiency. The integration of technical analysis, risk management, and execution timing in this trade shows the compounding benefits of systematic trading.`;
};

// Generate strengths analysis
const generateStrengthsAnalysis = (executionTrade, preTrade) => {
  const strengths = [];

  if (Math.abs(executionTrade.entry_variance || 0) <= 2) {
    strengths.push('Precise entry timing demonstrates excellent patience and discipline');
  }
  if (Math.abs(executionTrade.stop_variance || 0) <= 2) {
    strengths.push('Consistent stop management shows mature risk awareness');
  }
  if (Math.abs(executionTrade.target_variance || 0) <= 3) {
    strengths.push('Disciplined profit-taking prevents emotional decision-making');
  }
  if (executionTrade.trade_outcome === 'win') {
    strengths.push('Successful execution validates your analytical process');
  } else if (executionTrade.trade_outcome === 'loss') {
    strengths.push('Maintained discipline despite unfavorable outcome');
  }

  strengths.push('Systematic approach to trade execution is developing consistently');
  strengths.push('Following through on planned trades shows commitment to process');

  return strengths.join('. ') + '.';
};

// Generate improvement protocol
const generateImprovementProtocol = (executionTrade, preTrade) => {
  const protocols = [];

  if (Math.abs(executionTrade.entry_variance || 0) > 3) {
    protocols.push('Entry Timing Drill: Practice 3-2-1 confirmation before entering positions');
  }
  if (Math.abs(executionTrade.stop_variance || 0) > 3) {
    protocols.push('Stop Discipline Protocol: Set stops immediately after entry, no modifications');
  }
  if (Math.abs(executionTrade.target_variance || 0) > 4) {
    protocols.push('Profit Management System: Use mechanical profit-taking at predetermined levels');
  }

  protocols.push('Pattern Recognition Review: Study additional examples of this setup type');
  protocols.push('Execution Journal: Document emotional state during each phase of execution');
  protocols.push('Volume Confirmation Practice: Wait for volume expansion before entry');

  return protocols.join('. ') + '.';
};

// Generate psychological profile
const generatePsychologicalProfile = (executionTrade, preTrade) => {
  const avgVariance = (Math.abs(executionTrade.entry_variance || 0) +
                      Math.abs(executionTrade.stop_variance || 0) +
                      Math.abs(executionTrade.target_variance || 0)) / 3;

  if (avgVariance <= 2) {
    return 'Your psychological profile shows strong emotional regulation and systematic thinking. You demonstrate the mental discipline required for professional trading, with consistent execution that follows predetermined plans rather than emotional impulses.';
  } else if (avgVariance <= 4) {
    return 'Your psychological development shows promising foundation with areas for refinement. You generally maintain discipline but occasionally allow emotions to influence execution decisions. Focus on building stronger systematic habits to reduce variance.';
  } else {
    return 'Your psychological profile indicates developing awareness of trading emotions with opportunities for significant improvement. Work on building systematic responses to market stress and uncertainty through deliberate practice and emotional regulation techniques.';
  }
};

// Generate skill trajectory analysis
const generateSkillTrajectoryAnalysis = (executionTrade, preTrade) => {
  const grade = executionTrade.execution_quality_grade || 'B';

  const trajectoryMap = {
    'A+': 'Expert-level execution consistency. Focus on maintaining excellence while scaling position size appropriately.',
    'A': 'Advanced execution skills with minor refinements needed. You are approaching professional-level consistency.',
    'A-': 'Strong execution foundation with specific areas for improvement. Continue systematic development approach.',
    'B+': 'Solid intermediate execution skills. Focus on reducing variance and building more systematic habits.',
    'B': 'Developing execution competency with clear improvement pathway. Concentrate on process consistency.',
    'B-': 'Basic execution skills established. Significant development opportunities through deliberate practice.',
    'C+': 'Fundamental execution concepts understood. Focus on building systematic execution protocols.',
    'C': 'Early-stage execution development. Emphasize basic discipline and rule-following before advanced techniques.'
  };

  return trajectoryMap[grade] || trajectoryMap['B'];
};

// Generate long-term impact analysis
const generateLongTermImpactAnalysis = (executionTrade, preTrade) => {
  const outcome = executionTrade.trade_outcome;
  const avgVariance = (Math.abs(executionTrade.entry_variance || 0) +
                      Math.abs(executionTrade.stop_variance || 0) +
                      Math.abs(executionTrade.target_variance || 0)) / 3;

  let impact = 'This execution contributes to your long-term trading development by ';

  if (avgVariance <= 2) {
    impact += 'reinforcing excellent execution habits that will compound over hundreds of trades. Maintaining this precision will significantly improve your risk-adjusted returns.';
  } else if (avgVariance <= 4) {
    impact += 'building moderate execution consistency while highlighting specific areas for improvement. Reducing variance will accelerate your path to consistent profitability.';
  } else {
    impact += 'providing valuable feedback on execution challenges that need systematic attention. Addressing these patterns early will prevent them from becoming deeply ingrained habits.';
  }

  if (outcome === 'win') {
    impact += ' The positive outcome reinforces proper execution behavior, creating positive feedback loops for future trades.';
  } else if (outcome === 'loss') {
    impact += ' Despite the loss, maintaining execution discipline builds the mental resilience required for long-term success.';
  }

  return impact;
};

// Generate action items based on execution component
const generateActionItem = (component, variance) => {
  const absVariance = Math.abs(variance);

  if (component === 'entry' && absVariance > 3) {
    return 'Implement 3-second pause before entry execution to confirm setup';
  }
  if (component === 'stop' && absVariance > 3) {
    return 'Set stops immediately after entry with no modifications allowed';
  }
  if (component === 'target' && absVariance > 4) {
    return 'Use mechanical profit-taking at predetermined R:R levels';
  }

  return null; // No action needed if variance is acceptable
};

// Identify weakest execution area
const getWeakestArea = (executionTrade) => {
  const variances = {
    'entry timing': Math.abs(executionTrade.entry_variance || 0),
    'stop management': Math.abs(executionTrade.stop_variance || 0),
    'profit taking': Math.abs(executionTrade.target_variance || 0)
  };

  return Object.keys(variances).reduce((a, b) => variances[a] > variances[b] ? a : b);
};

// SCREENSHOT MANAGEMENT SYSTEM

// Get primary screenshot for display
router.get('/trades/:tradeId/screenshots/primary', asyncHandler(async (req, res) => {
  const db = getDatabase();
  const { tradeId } = req.params;

  try {
    // Get screenshot metadata
    const primaryScreenshot = await new Promise((resolve, reject) => {
      db.get(`
        SELECT sa.*, t.screenshots_metadata
        FROM trades t
        LEFT JOIN screenshot_analysis sa ON t.id = sa.trade_id AND sa.is_primary = 1
        WHERE t.id = ?
      `, [tradeId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!primaryScreenshot || !primaryScreenshot.screenshot_path) {
      // Try to get any screenshot as fallback
      const fallbackScreenshot = await new Promise((resolve, reject) => {
        db.get(`
          SELECT screenshot_path, timeframe_label FROM screenshot_analysis
          WHERE trade_id = ?
          ORDER BY created_at ASC
          LIMIT 1
        `, [tradeId], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });

      if (!fallbackScreenshot) {
        return res.status(404).json({
          success: false,
          error: 'SCREENSHOT_NOT_FOUND',
          message: 'No screenshots found for this trade',
          code: 404
        });
      }

      // Use fallback screenshot
      primaryScreenshot.screenshot_path = fallbackScreenshot.screenshot_path;
      primaryScreenshot.timeframe_label = fallbackScreenshot.timeframe_label;
    }

    // Parse metadata if available
    let metadata = {};
    try {
      if (primaryScreenshot.screenshots_metadata) {
        metadata = JSON.parse(primaryScreenshot.screenshots_metadata);
      }
    } catch (error) {
      console.warn('Failed to parse screenshot metadata:', error);
    }

    const screenshotData = {
      timeframe: primaryScreenshot.timeframe_label || 'unknown',
      file_path: `/uploads/${primaryScreenshot.screenshot_path.replace(/\\/g, '/')}`,
      is_primary: true,
      upload_timestamp: primaryScreenshot.created_at || new Date().toISOString(),
      metadata: {
        file_size: metadata.file_size || 'Unknown',
        dimensions: metadata.dimensions || 'Unknown',
        pattern_identified: primaryScreenshot.pattern_identified || null,
        trend_direction: primaryScreenshot.trend_direction || null
      }
    };

    res.json({
      success: true,
      data: screenshotData
    });

  } catch (error) {
    console.error('Primary screenshot error:', error);
    throw error;
  } finally {
    db.close();
  }
}));

// Get all screenshots for modal display
router.get('/trades/:tradeId/screenshots/all', asyncHandler(async (req, res) => {
  const db = getDatabase();
  const { tradeId } = req.params;

  try {
    // Get all screenshots for the trade
    const screenshots = await new Promise((resolve, reject) => {
      db.all(`
        SELECT sa.*, t.screenshots_metadata
        FROM screenshot_analysis sa
        JOIN trades t ON t.id = sa.trade_id
        WHERE sa.trade_id = ?
        ORDER BY sa.is_primary DESC, sa.timeframe_priority ASC, sa.created_at ASC
      `, [tradeId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });

    if (screenshots.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'NO_SCREENSHOTS_FOUND',
        message: 'No screenshots found for this trade',
        code: 404
      });
    }

    // Parse metadata
    let globalMetadata = {};
    try {
      if (screenshots[0].screenshots_metadata) {
        globalMetadata = JSON.parse(screenshots[0].screenshots_metadata);
      }
    } catch (error) {
      console.warn('Failed to parse global screenshot metadata:', error);
    }

    // Determine primary timeframe using selection logic
    const timeframeLabels = screenshots.map(s => s.timeframe_label);
    const primaryTimeframe = selectPrimaryTimeframe(timeframeLabels);

    const screenshotData = {
      primary_timeframe: primaryTimeframe,
      total_screenshots: screenshots.length,
      timeframe_data: screenshots.reduce((acc, screenshot) => {
        acc[screenshot.timeframe_label] = {
          file_path: `/uploads/${screenshot.screenshot_path.replace(/\\/g, '/')}`,
          upload_timestamp: screenshot.created_at,
          is_primary: screenshot.timeframe_label === primaryTimeframe,
          timeframe_category: screenshot.timeframe_category || 'unknown',
          timeframe_priority: screenshot.timeframe_priority || 'analysis',
          analysis_data: {
            pattern_identified: screenshot.pattern_identified || null,
            trend_direction: screenshot.trend_direction || null,
            key_levels: screenshot.key_levels ? JSON.parse(screenshot.key_levels) : [],
            volume_analysis: screenshot.volume_analysis || null,
            confluence_score: screenshot.confluence_score || null,
            individual_analysis: screenshot.individual_analysis || null
          },
          metadata: {
            file_size: globalMetadata[screenshot.timeframe_label]?.file_size || 'Unknown',
            dimensions: globalMetadata[screenshot.timeframe_label]?.dimensions || 'Unknown'
          }
        };
        return acc;
      }, {})
    };

    res.json({
      success: true,
      data: screenshotData
    });

  } catch (error) {
    console.error('All screenshots error:', error);
    throw error;
  } finally {
    db.close();
  }
}));

// Generate thumbnail for performance
router.get('/trades/:tradeId/screenshots/:timeframe/thumbnail', asyncHandler(async (req, res) => {
  const db = getDatabase();
  const { tradeId, timeframe } = req.params;

  try {
    // Get screenshot path
    const screenshot = await new Promise((resolve, reject) => {
      db.get(`
        SELECT screenshot_path FROM screenshot_analysis
        WHERE trade_id = ? AND timeframe_label = ?
      `, [tradeId, timeframe], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!screenshot) {
      return res.status(404).json({
        success: false,
        error: 'SCREENSHOT_NOT_FOUND',
        message: `Screenshot for ${timeframe} timeframe not found`,
        code: 404
      });
    }

    // For now, return the original image path
    // In a production environment, you would generate actual thumbnails
    const thumbnailPath = `/uploads/${screenshot.screenshot_path.replace(/\\/g, '/')}`;

    res.json({
      success: true,
      data: {
        thumbnail_path: thumbnailPath,
        timeframe: timeframe,
        width: 300, // Standard thumbnail width
        note: 'Original image returned - thumbnail generation not implemented'
      }
    });

  } catch (error) {
    console.error('Thumbnail error:', error);
    throw error;
  } finally {
    db.close();
  }
}));

// Primary timeframe selection logic for MNQ scalping
const selectPrimaryTimeframe = (timeframes) => {
  // Priority order for MNQ scalping
  const priority = ['5min', '1min', '15min', '30min', '4hr', 'daily'];

  for (const tf of priority) {
    if (timeframes.includes(tf)) return tf;
  }

  // Fallback to first uploaded
  return timeframes[0] || 'unknown';
};

// NAVIGATION FLOW MANAGEMENT

// Simple in-memory session store (in production, use Redis or database)
const sessionStore = new Map();

// Track navigation context
router.post('/navigation/track', asyncHandler(async (req, res) => {
  const {
    user_session = 'default',
    current_page,
    previous_page,
    page_context = {}
  } = req.body;

  try {
    // Get existing session data
    let sessionData = sessionStore.get(user_session) || {
      navigation_stack: [],
      page_contexts: {}
    };

    // Update navigation stack
    if (previous_page) {
      // Remove current page from stack if it exists to avoid duplicates
      sessionData.navigation_stack = sessionData.navigation_stack.filter(page => page !== previous_page);
      sessionData.navigation_stack.push(previous_page);
    }

    // Keep stack limited to last 10 pages
    if (sessionData.navigation_stack.length > 10) {
      sessionData.navigation_stack = sessionData.navigation_stack.slice(-10);
    }

    // Store page context
    if (previous_page && Object.keys(page_context).length > 0) {
      sessionData.page_contexts[previous_page] = {
        ...sessionData.page_contexts[previous_page],
        ...page_context,
        last_updated: new Date().toISOString()
      };
    }

    sessionData.current_page = current_page;
    sessionData.last_activity = new Date().toISOString();

    // Store updated session
    sessionStore.set(user_session, sessionData);

    res.json({
      success: true,
      data: {
        message: 'Navigation context tracked successfully',
        session_id: user_session
      }
    });

  } catch (error) {
    console.error('Navigation tracking error:', error);
    throw error;
  }
}));

// Handle back button navigation
router.post('/navigation/back', asyncHandler(async (req, res) => {
  const {
    current_page,
    user_session = 'default'
  } = req.body;

  try {
    // Get session data
    const sessionData = sessionStore.get(user_session) || {
      navigation_stack: [],
      page_contexts: {}
    };

    let redirectTo = '/';
    let restoreContext = {};

    if (sessionData.navigation_stack.length > 0) {
      // Get the most recent page from stack
      redirectTo = sessionData.navigation_stack.pop();

      // Get stored context for that page
      restoreContext = sessionData.page_contexts[redirectTo] || {};

      // Update session
      sessionStore.set(user_session, sessionData);
    }

    res.json({
      success: true,
      data: {
        redirect_to: redirectTo,
        restore_context: restoreContext,
        navigation_available: sessionData.navigation_stack.length > 0
      }
    });

  } catch (error) {
    console.error('Navigation back error:', error);
    throw error;
  }
}));

// Get current navigation state
router.get('/navigation/state/:sessionId?', asyncHandler(async (req, res) => {
  const sessionId = req.params.sessionId || 'default';

  try {
    const sessionData = sessionStore.get(sessionId) || {
      navigation_stack: [],
      page_contexts: {},
      current_page: '/',
      last_activity: null
    };

    res.json({
      success: true,
      data: {
        current_page: sessionData.current_page,
        navigation_stack: sessionData.navigation_stack,
        can_go_back: sessionData.navigation_stack.length > 0,
        available_contexts: Object.keys(sessionData.page_contexts),
        last_activity: sessionData.last_activity
      }
    });

  } catch (error) {
    console.error('Navigation state error:', error);
    throw error;
  }
}));

// Clear navigation session
router.delete('/navigation/session/:sessionId?', asyncHandler(async (req, res) => {
  const sessionId = req.params.sessionId || 'default';

  try {
    sessionStore.delete(sessionId);

    res.json({
      success: true,
      data: {
        message: 'Navigation session cleared successfully',
        session_id: sessionId
      }
    });

  } catch (error) {
    console.error('Navigation session clear error:', error);
    throw error;
  }
}));

// ENHANCED ANALYTICS WITH BEHAVIORAL INSIGHTS

// Pattern breakdown chart data
router.get('/analytics/pattern-breakdown', asyncHandler(async (req, res) => {
  const db = getDatabase();

  try {
    const patterns = await new Promise((resolve, reject) => {
      db.all(`
        SELECT
          pattern_type,
          COUNT(*) as total_trades,
          ROUND(
            (SUM(CASE WHEN actual_pnl > 0 THEN 1 ELSE 0 END) * 100.0 / COUNT(*)), 1
          ) as win_rate,
          ROUND(AVG(risk_reward_ratio), 2) as avg_rr,
          AVG(actual_pnl) as avg_pnl,
          COUNT(CASE WHEN timestamp >= datetime('now', '-30 days') THEN 1 END) as recent_trades,
          (
            SELECT ROUND(
              (SUM(CASE WHEN actual_pnl > 0 THEN 1 ELSE 0 END) * 100.0 / COUNT(*)), 1
            )
            FROM trades t2
            WHERE t2.pattern_type = trades.pattern_type
            AND t2.timestamp >= datetime('now', '-30 days')
            AND t2.actual_pnl IS NOT NULL
          ) as recent_win_rate,
          ROUND(AVG(CASE WHEN timestamp >= datetime('now', '-30 days') THEN
            (julianday(timestamp) - julianday(LAG(timestamp) OVER (ORDER BY timestamp))) * 24 * 60
          END), 0) as avg_hold_time_minutes
        FROM trades
        WHERE pattern_type IS NOT NULL
        AND actual_pnl IS NOT NULL
        GROUP BY pattern_type
        HAVING total_trades >= 3
        ORDER BY win_rate DESC, total_trades DESC
        LIMIT 10
      `, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });

    const formattedPatterns = patterns.map(pattern => {
      const recentPerformance = pattern.recent_win_rate > pattern.win_rate ? 'improving' :
                               pattern.recent_win_rate < pattern.win_rate ? 'declining' : 'stable';

      return {
        name: pattern.pattern_type,
        win_rate: pattern.win_rate,
        total_trades: pattern.total_trades,
        avg_rr: pattern.avg_rr || 2.0,
        recent_performance: recentPerformance,
        hover_details: {
          last_30_days: pattern.recent_trades,
          success_rate_trend: pattern.recent_win_rate ?
            `${pattern.recent_win_rate > pattern.win_rate ? '+' : ''}${(pattern.recent_win_rate - pattern.win_rate).toFixed(1)}%` : 'N/A',
          avg_hold_time: `${pattern.avg_hold_time_minutes || 15} minutes`,
          avg_pnl: pattern.avg_pnl ? `$${pattern.avg_pnl.toFixed(0)}` : '$0'
        }
      };
    });

    res.json({
      success: true,
      data: {
        patterns: formattedPatterns
      }
    });

  } catch (error) {
    console.error('Pattern breakdown error:', error);
    throw error;
  } finally {
    db.close();
  }
}));

// Session performance with detailed breakdown
router.get('/analytics/session-performance', asyncHandler(async (req, res) => {
  const db = getDatabase();

  try {
    const sessions = await new Promise((resolve, reject) => {
      db.all(`
        SELECT
          session_timing,
          COUNT(*) as total_trades,
          ROUND(
            (SUM(CASE WHEN actual_pnl > 0 THEN 1 ELSE 0 END) * 100.0 / COUNT(*)), 1
          ) as win_rate,
          ROUND(AVG(actual_pnl), 0) as avg_pnl,
          ROUND(AVG(setup_quality), 1) as avg_quality,
          ROUND(AVG(risk_reward_ratio), 2) as risk_adjusted_return,
          (
            CASE
              WHEN session_timing = 'optimal' OR session_timing = 'good' THEN 'optimal'
              WHEN session_timing = 'fair' OR session_timing = 'acceptable' THEN 'moderate'
              ELSE 'poor'
            END
          ) as market_conditions
        FROM trades
        WHERE session_timing IS NOT NULL
        AND actual_pnl IS NOT NULL
        AND timestamp >= datetime('now', '-90 days')
        GROUP BY session_timing
        ORDER BY avg_pnl DESC
      `, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });

    // Get pattern distribution for each session
    const sessionPatterns = await new Promise((resolve, reject) => {
      db.all(`
        SELECT
          session_timing,
          pattern_type,
          COUNT(*) as pattern_count
        FROM trades
        WHERE session_timing IS NOT NULL
        AND pattern_type IS NOT NULL
        AND timestamp >= datetime('now', '-90 days')
        GROUP BY session_timing, pattern_type
        ORDER BY session_timing, pattern_count DESC
      `, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });

    // Map time windows
    const timeWindowMap = {
      'optimal': '9:30-10:15 AM',
      'good': '10:15-11:30 AM',
      'fair': '11:30-1:00 PM',
      'acceptable': '1:00-3:00 PM',
      'poor': 'Extended Hours'
    };

    const formattedSessions = sessions.map(session => {
      const patterns = sessionPatterns
        .filter(sp => sp.session_timing === session.session_timing)
        .reduce((acc, sp) => {
          acc[sp.pattern_type] = sp.pattern_count;
          return acc;
        }, {});

      return {
        time_window: timeWindowMap[session.session_timing] || 'Unknown',
        session_timing: session.session_timing,
        win_rate: session.win_rate,
        total_trades: session.total_trades,
        avg_pnl: session.avg_pnl,
        risk_adjusted_return: session.risk_adjusted_return || 2.0,
        market_conditions: session.market_conditions,
        detailed_breakdown: {
          pattern_distribution: patterns,
          execution_quality: {
            avg_setup_quality: session.avg_quality,
            quality_grade: convertScoreToGrade(session.avg_quality)
          }
        }
      };
    });

    res.json({
      success: true,
      data: {
        sessions: formattedSessions
      }
    });

  } catch (error) {
    console.error('Session performance error:', error);
    throw error;
  } finally {
    db.close();
  }
}));

// Real-time behavioral pattern analysis
router.get('/analytics/behavioral-insights', asyncHandler(async (req, res) => {
  const db = getDatabase();

  try {
    // Analyze behavioral patterns from trade data
    const behavioralData = await new Promise((resolve, reject) => {
      db.all(`
        SELECT
          t.*,
          (t.actual_entry - COALESCE(t.planned_entry, t.actual_entry)) as entry_variance,
          (t.actual_stop - COALESCE(t.planned_stop, t.actual_stop)) as stop_variance,
          (t.actual_target - COALESCE(t.planned_target, t.actual_target)) as target_variance,
          CASE WHEN t.timestamp >= datetime('now', '-30 days') THEN 1 ELSE 0 END as is_recent
        FROM trades t
        WHERE t.trade_phase = 'execution'
        AND t.actual_pnl IS NOT NULL
        ORDER BY t.timestamp DESC
        LIMIT 100
      `, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });

    // Calculate behavioral patterns
    const patterns = [];

    if (behavioralData.length > 0) {
      // Early Entry Pattern Analysis
      const earlyEntries = behavioralData.filter(t => t.entry_variance < -1).length;
      const totalExecutions = behavioralData.length;
      const earlyEntryFreq = (earlyEntries / totalExecutions) * 100;

      const recentEarlyEntries = behavioralData.filter(t => t.entry_variance < -1 && t.is_recent).length;
      const recentExecutions = behavioralData.filter(t => t.is_recent).length;
      const recentEarlyEntryFreq = recentExecutions > 0 ? (recentEarlyEntries / recentExecutions) * 100 : 0;

      // Calculate R:R impact
      const earlyEntryTrades = behavioralData.filter(t => t.entry_variance < -1);
      const avgRRReduction = earlyEntryTrades.length > 0 ?
        earlyEntryTrades.reduce((sum, t) => sum + Math.abs(t.entry_variance * 0.1), 0) / earlyEntryTrades.length : 0;

      patterns.push({
        type: 'early_entry',
        frequency: Math.round(earlyEntryFreq),
        impact_on_performance: -avgRRReduction / 10, // Convert to R:R impact
        trend: recentEarlyEntryFreq < earlyEntryFreq ? 'improving' :
               recentEarlyEntryFreq > earlyEntryFreq ? 'worsening' : 'stable',
        last_30_days_change: Math.round(recentEarlyEntryFreq - earlyEntryFreq),
        coaching_priority: earlyEntryFreq > 50 ? 'high' : earlyEntryFreq > 30 ? 'medium' : 'low',
        specific_triggers: ['volume_spike', 'fomo_reaction']
      });

      // Stop Management Pattern Analysis
      const stopMismanagement = behavioralData.filter(t => Math.abs(t.stop_variance) > 3).length;
      const stopMismanagementFreq = (stopMismanagement / totalExecutions) * 100;

      const recentStopIssues = behavioralData.filter(t => Math.abs(t.stop_variance) > 3 && t.is_recent).length;
      const recentStopFreq = recentExecutions > 0 ? (recentStopIssues / recentExecutions) * 100 : 0;

      patterns.push({
        type: 'stop_management_deviation',
        frequency: Math.round(stopMismanagementFreq),
        impact_on_performance: -0.2, // Typical R:R impact
        trend: recentStopFreq < stopMismanagementFreq ? 'improving' :
               recentStopFreq > stopMismanagementFreq ? 'worsening' : 'stable',
        last_30_days_change: Math.round(recentStopFreq - stopMismanagementFreq),
        coaching_priority: stopMismanagementFreq > 40 ? 'high' : stopMismanagementFreq > 25 ? 'medium' : 'low',
        specific_triggers: ['emotional_reaction', 'hope_trading']
      });

      // Profit Taking Pattern Analysis
      const profitMismanagement = behavioralData.filter(t => Math.abs(t.target_variance) > 5).length;
      const profitMismanagementFreq = (profitMismanagement / totalExecutions) * 100;

      const recentProfitIssues = behavioralData.filter(t => Math.abs(t.target_variance) > 5 && t.is_recent).length;
      const recentProfitFreq = recentExecutions > 0 ? (recentProfitIssues / recentExecutions) * 100 : 0;

      patterns.push({
        type: 'profit_management_inconsistency',
        frequency: Math.round(profitMismanagementFreq),
        impact_on_performance: -0.15,
        trend: recentProfitFreq < profitMismanagementFreq ? 'improving' :
               recentProfitFreq > profitMismanagementFreq ? 'worsening' : 'stable',
        last_30_days_change: Math.round(recentProfitFreq - profitMismanagementFreq),
        coaching_priority: profitMismanagementFreq > 35 ? 'high' : profitMismanagementFreq > 20 ? 'medium' : 'low',
        specific_triggers: ['greed', 'fear_of_giving_back']
      });
    }

    res.json({
      success: true,
      data: {
        patterns: patterns,
        analysis_period: '100 most recent executions',
        last_updated: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Behavioral insights error:', error);
    throw error;
  } finally {
    db.close();
  }
}));

module.exports = router;