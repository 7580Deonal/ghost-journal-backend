const express = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { getDatabase, getWeekNumber } = require('../models/database');

const router = express.Router();

router.get('/patterns',
  asyncHandler(async (req, res) => {
    const db = getDatabase();

    try {
      const patterns = await getAllPatterns(db);
      const patternAnalysis = await getPatternAnalysis(db);
      const recommendations = generatePatternRecommendations(patterns);

      res.json({
        success: true,
        data: {
          trading_style: 'opening_session_scalper',
          preferred_setups: patterns,
          pattern_analysis: patternAnalysis,
          risk_profile: await calculateRiskProfile(db),
          optimal_conditions: await getOptimalConditions(db),
          recommendations: recommendations
        }
      });

    } catch (error) {
      console.error('Pattern analysis error:', error);
      throw error;
    } finally {
      db.close();
    }
  })
);

router.get('/patterns/:patternName',
  asyncHandler(async (req, res) => {
    const { patternName } = req.params;
    const db = getDatabase();

    try {
      const patternDetails = await getPatternDetails(db, patternName);

      if (!patternDetails) {
        return res.status(404).json({
          success: false,
          error: 'Pattern not found'
        });
      }

      const relatedTrades = await getPatternTrades(db, patternName);
      const performance = await getPatternPerformance(db, patternName);

      res.json({
        success: true,
        data: {
          pattern: patternDetails,
          trades: relatedTrades,
          performance: performance,
          insights: generatePatternInsights(patternDetails, relatedTrades, performance)
        }
      });

    } catch (error) {
      console.error('Pattern details error:', error);
      throw error;
    } finally {
      db.close();
    }
  })
);

router.post('/patterns/learn',
  asyncHandler(async (req, res) => {
    const { pattern_name, outcome, notes } = req.body;

    if (!pattern_name) {
      return res.status(400).json({
        success: false,
        error: 'Pattern name is required'
      });
    }

    const db = getDatabase();

    try {
      await updatePatternLearning(db, pattern_name, outcome, notes);
      const updatedPattern = await getPatternDetails(db, pattern_name);

      res.json({
        success: true,
        message: 'Pattern learning updated successfully',
        data: updatedPattern
      });

    } catch (error) {
      console.error('Pattern learning error:', error);
      throw error;
    } finally {
      db.close();
    }
  })
);

router.get('/patterns/analysis/correlation',
  asyncHandler(async (req, res) => {
    const db = getDatabase();

    try {
      const correlations = await getPatternCorrelations(db);
      const seasonality = await getPatternSeasonality(db);
      const marketConditions = await getPatternMarketConditions(db);

      res.json({
        success: true,
        data: {
          correlations: correlations,
          seasonality: seasonality,
          market_conditions: marketConditions,
          insights: generateCorrelationInsights(correlations, seasonality)
        }
      });

    } catch (error) {
      console.error('Pattern correlation error:', error);
      throw error;
    } finally {
      db.close();
    }
  })
);

router.get('/patterns/recommendations/today',
  asyncHandler(async (req, res) => {
    const db = getDatabase();
    const currentTime = new Date();
    const currentWeek = getWeekNumber(currentTime);
    const currentYear = currentTime.getFullYear();

    try {
      const weekContext = await getWeekContext(db, currentWeek, currentYear);
      const bestPatterns = await getBestPatternsForToday(db);
      const recommendations = await generateTodayRecommendations(db, weekContext, bestPatterns);

      res.json({
        success: true,
        data: {
          date: currentTime.toISOString().split('T')[0],
          week_context: weekContext,
          recommended_patterns: recommendations,
          market_conditions: await getCurrentMarketConditions(db),
          session_focus: 'Opening session (9:30-10:15 AM EST)'
        }
      });

    } catch (error) {
      console.error('Daily recommendations error:', error);
      throw error;
    } finally {
      db.close();
    }
  })
);

router.get('/execution-patterns',
  asyncHandler(async (req, res) => {
    const db = getDatabase();

    try {
      const executionPatterns = await getExecutionPatterns(db);
      const dominantPatterns = await getDominantExecutionPatterns(db);
      const trendAnalysis = await analyzeExecutionTrends(db);

      res.json({
        success: true,
        data: {
          dominant_patterns: dominantPatterns,
          all_patterns: executionPatterns,
          trend_analysis: trendAnalysis,
          coaching_insights: generateExecutionCoachingInsights(dominantPatterns)
        }
      });

    } catch (error) {
      console.error('Execution patterns error:', error);
      throw error;
    } finally {
      db.close();
    }
  })
);

const getAllPatterns = (db) => {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT
        p.*,
        CASE
          WHEN p.total_count > 0 THEN (p.success_count * 1.0 / p.total_count) * 100
          ELSE 0
        END as success_rate,
        COALESCE(t.avg_pnl, 0) as avg_return,
        COALESCE(t.frequency, 0) as frequency
      FROM patterns p
      LEFT JOIN (
        SELECT
          pattern_type,
          AVG(actual_pnl) as avg_pnl,
          COUNT(*) as frequency
        FROM trades
        WHERE executed = 1 AND actual_pnl IS NOT NULL
        GROUP BY pattern_type
      ) t ON p.pattern_name = t.pattern_type
      ORDER BY success_rate DESC, frequency DESC
    `, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
};

const getPatternAnalysis = (db) => {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT
        pattern_type,
        COUNT(*) as total_occurrences,
        COUNT(CASE WHEN executed = 1 THEN 1 END) as executed_count,
        COUNT(CASE WHEN executed = 1 AND actual_pnl > 0 THEN 1 END) as winning_count,
        AVG(setup_quality) as avg_setup_quality,
        AVG(risk_reward_ratio) as avg_risk_reward,
        AVG(CASE WHEN executed = 1 THEN actual_pnl END) as avg_pnl,
        MAX(timestamp) as last_seen
      FROM trades
      WHERE pattern_type IS NOT NULL
      GROUP BY pattern_type
      ORDER BY avg_pnl DESC
    `, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }

      const analysis = (rows || []).map(row => ({
        pattern: row.pattern_type,
        total_occurrences: row.total_occurrences,
        execution_rate: row.total_occurrences > 0 ?
          Math.round((row.executed_count / row.total_occurrences) * 100) : 0,
        win_rate: row.executed_count > 0 ?
          Math.round((row.winning_count / row.executed_count) * 100) : 0,
        avg_setup_quality: Math.round((row.avg_setup_quality || 0) * 10) / 10,
        avg_risk_reward: Math.round((row.avg_risk_reward || 0) * 10) / 10,
        avg_return: Math.round((row.avg_pnl || 0) * 100) / 100,
        last_seen: row.last_seen,
        profitability_score: calculateProfitabilityScore(row)
      }));

      resolve(analysis);
    });
  });
};

const calculateProfitabilityScore = (patternData) => {
  const executionRate = patternData.total_occurrences > 0 ?
    (patternData.executed_count / patternData.total_occurrences) : 0;
  const winRate = patternData.executed_count > 0 ?
    (patternData.winning_count / patternData.executed_count) : 0;
  const avgReturn = patternData.avg_pnl || 0;
  const setupQuality = (patternData.avg_setup_quality || 0) / 10;

  return Math.round(((executionRate * 0.3) + (winRate * 0.4) + (avgReturn * 0.2) + (setupQuality * 0.1)) * 100);
};

const generatePatternRecommendations = (patterns) => {
  const recommendations = [];

  const topPattern = patterns.find(p => p.success_rate > 70 && p.frequency >= 5);
  if (topPattern) {
    recommendations.push({
      type: 'focus',
      pattern: topPattern.pattern_name,
      message: `Focus on ${topPattern.pattern_name} - ${Math.round(topPattern.success_rate)}% success rate`,
      priority: 'high'
    });
  }

  const lowPerformer = patterns.find(p => p.success_rate < 40 && p.frequency >= 3);
  if (lowPerformer) {
    recommendations.push({
      type: 'avoid',
      pattern: lowPerformer.pattern_name,
      message: `Consider avoiding ${lowPerformer.pattern_name} - only ${Math.round(lowPerformer.success_rate)}% success rate`,
      priority: 'medium'
    });
  }

  const underutilized = patterns.find(p => p.success_rate > 60 && p.frequency < 3);
  if (underutilized) {
    recommendations.push({
      type: 'explore',
      pattern: underutilized.pattern_name,
      message: `Explore more ${underutilized.pattern_name} setups - good success rate but low frequency`,
      priority: 'low'
    });
  }

  return recommendations;
};

const calculateRiskProfile = (db) => {
  return new Promise((resolve, reject) => {
    db.get(`
      SELECT
        AVG(risk_amount) as avg_risk,
        MAX(risk_amount) as max_risk,
        COUNT(CASE WHEN within_limits = 0 THEN 1 END) as violations,
        COUNT(*) as total_trades,
        AVG(risk_reward_ratio) as avg_risk_reward
      FROM trades
      WHERE executed = 1
    `, (err, row) => {
      if (err) {
        reject(err);
        return;
      }

      const data = row || {};
      const violationRate = data.total_trades > 0 ?
        (data.violations / data.total_trades) * 100 : 0;

      let profile = 'conservative';
      if (data.avg_risk > 40 || violationRate > 10) {
        profile = 'aggressive';
      } else if (data.avg_risk > 25 || violationRate > 5) {
        profile = 'moderate';
      }

      resolve({
        profile: profile,
        avg_risk_per_trade: Math.round((data.avg_risk || 0) * 100) / 100,
        max_risk_taken: data.max_risk || 0,
        rule_violations: data.violations || 0,
        violation_rate: Math.round(violationRate * 10) / 10,
        avg_risk_reward_ratio: Math.round((data.avg_risk_reward || 0) * 10) / 10,
        assessment: generateRiskAssessment(profile, violationRate, data.avg_risk_reward || 0)
      });
    });
  });
};

const generateRiskAssessment = (profile, violationRate, avgRiskReward) => {
  const assessments = [];

  if (profile === 'conservative') {
    assessments.push('Risk management discipline is strong');
  } else if (profile === 'aggressive') {
    assessments.push('Consider reducing position sizes for better risk control');
  }

  if (violationRate > 5) {
    assessments.push(`${Math.round(violationRate)}% rule violations need attention`);
  }

  if (avgRiskReward < 2.0) {
    assessments.push('Target higher reward-to-risk ratios (>2:1)');
  } else {
    assessments.push('Risk-reward targeting is appropriate');
  }

  return assessments;
};

const getOptimalConditions = (db) => {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT
        session_timing,
        COUNT(*) as frequency,
        AVG(CASE WHEN executed = 1 THEN actual_pnl END) as avg_pnl,
        COUNT(CASE WHEN executed = 1 AND actual_pnl > 0 THEN 1 END) as wins,
        COUNT(CASE WHEN executed = 1 THEN 1 END) as total_executed
      FROM trades
      WHERE executed = 1
      GROUP BY session_timing
      ORDER BY avg_pnl DESC
    `, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }

      const bestTiming = (rows || [])[0];

      resolve({
        time_window: '9:30-10:15 AM EST',
        best_performance_timing: bestTiming?.session_timing || 'optimal',
        volume_threshold: '150% of 20-day average',
        volatility_range: 'moderate (0.5-1.5% NQ range)',
        market_conditions: 'Opening session with clear directional bias',
        success_factors: [
          'Clear volume confirmation',
          'Clean technical setup',
          'Proper risk-reward ratio (>2:1)',
          'Session timing alignment'
        ]
      });
    });
  });
};

const getPatternDetails = (db, patternName) => {
  return new Promise((resolve, reject) => {
    db.get(`
      SELECT * FROM patterns WHERE pattern_name = ?
    `, [patternName], (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

const getPatternTrades = (db, patternName) => {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT
        id,
        timestamp,
        setup_quality,
        risk_reward_ratio,
        recommendation,
        executed,
        actual_pnl,
        ai_commentary
      FROM trades
      WHERE pattern_type = ?
      ORDER BY timestamp DESC
      LIMIT 10
    `, [patternName], (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
};

const getPatternPerformance = (db, patternName) => {
  return new Promise((resolve, reject) => {
    db.get(`
      SELECT
        COUNT(*) as total_occurrences,
        COUNT(CASE WHEN executed = 1 THEN 1 END) as executed_count,
        COUNT(CASE WHEN executed = 1 AND actual_pnl > 0 THEN 1 END) as winning_trades,
        AVG(setup_quality) as avg_setup_quality,
        AVG(CASE WHEN executed = 1 THEN actual_pnl END) as avg_pnl,
        SUM(CASE WHEN executed = 1 THEN actual_pnl END) as total_pnl
      FROM trades
      WHERE pattern_type = ?
    `, [patternName], (err, row) => {
      if (err) {
        reject(err);
        return;
      }

      const data = row || {};
      const winRate = data.executed_count > 0 ?
        (data.winning_trades / data.executed_count) * 100 : 0;

      resolve({
        total_occurrences: data.total_occurrences || 0,
        execution_rate: data.total_occurrences > 0 ?
          Math.round((data.executed_count / data.total_occurrences) * 100) : 0,
        win_rate: Math.round(winRate),
        avg_setup_quality: Math.round((data.avg_setup_quality || 0) * 10) / 10,
        avg_pnl_per_trade: Math.round((data.avg_pnl || 0) * 100) / 100,
        total_contribution: Math.round((data.total_pnl || 0) * 100) / 100
      });
    });
  });
};

const generatePatternInsights = (pattern, trades, performance) => {
  const insights = [];

  if (performance.win_rate > 70) {
    insights.push(`Highly reliable pattern with ${performance.win_rate}% win rate`);
  } else if (performance.win_rate < 50) {
    insights.push(`Consider refining entry criteria - ${performance.win_rate}% win rate needs improvement`);
  }

  if (performance.execution_rate < 60) {
    insights.push(`Low execution rate (${performance.execution_rate}%) - may be too selective`);
  }

  if (performance.avg_setup_quality > 7) {
    insights.push('Consistently identifies high-quality setups');
  }

  const recentTrades = trades.slice(0, 3);
  if (recentTrades.length > 0) {
    const recentAvgQuality = recentTrades.reduce((sum, t) => sum + t.setup_quality, 0) / recentTrades.length;
    if (recentAvgQuality > performance.avg_setup_quality) {
      insights.push('Recent setup quality is improving');
    }
  }

  return insights;
};

const updatePatternLearning = (db, patternName, outcome, notes) => {
  return new Promise((resolve, reject) => {
    if (outcome === 'success') {
      db.run(`
        UPDATE patterns
        SET success_count = success_count + 1,
            confidence_score = MIN(1.0, confidence_score + 0.05),
            updated_at = datetime('now')
        WHERE pattern_name = ?
      `, [patternName], (err) => {
        if (err) reject(err);
        else resolve();
      });
    } else if (outcome === 'failure') {
      db.run(`
        UPDATE patterns
        SET confidence_score = MAX(0.0, confidence_score - 0.1),
            updated_at = datetime('now')
        WHERE pattern_name = ?
      `, [patternName], (err) => {
        if (err) reject(err);
        else resolve();
      });
    } else {
      resolve();
    }
  });
};

const getPatternCorrelations = (db) => {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT
        t1.pattern_type as pattern_a,
        t2.pattern_type as pattern_b,
        COUNT(*) as co_occurrences
      FROM trades t1
      JOIN trades t2 ON DATE(t1.timestamp) = DATE(t2.timestamp)
        AND t1.pattern_type != t2.pattern_type
        AND t1.id < t2.id
      GROUP BY t1.pattern_type, t2.pattern_type
      HAVING co_occurrences >= 2
      ORDER BY co_occurrences DESC
    `, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
};

const getPatternSeasonality = (db) => {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT
        pattern_type,
        CAST(strftime('%w', timestamp) as INTEGER) as day_of_week,
        COUNT(*) as frequency,
        AVG(CASE WHEN executed = 1 THEN actual_pnl END) as avg_pnl
      FROM trades
      WHERE executed = 1
      GROUP BY pattern_type, day_of_week
      ORDER BY pattern_type, frequency DESC
    `, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
};

const getPatternMarketConditions = (db) => {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT
        pattern_type,
        session_timing,
        COUNT(*) as frequency,
        AVG(setup_quality) as avg_quality,
        AVG(CASE WHEN executed = 1 THEN actual_pnl END) as avg_pnl
      FROM trades
      GROUP BY pattern_type, session_timing
      ORDER BY avg_pnl DESC
    `, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
};

const generateCorrelationInsights = (correlations, seasonality) => {
  const insights = [];

  if (correlations.length > 0) {
    const topCorrelation = correlations[0];
    insights.push(`${topCorrelation.pattern_a} and ${topCorrelation.pattern_b} often occur on the same day`);
  }

  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayFrequency = {};

  seasonality.forEach(item => {
    const day = dayNames[item.day_of_week];
    dayFrequency[day] = (dayFrequency[day] || 0) + item.frequency;
  });

  const bestDay = Object.keys(dayFrequency).reduce((a, b) =>
    dayFrequency[a] > dayFrequency[b] ? a : b
  );

  if (bestDay) {
    insights.push(`${bestDay} shows highest pattern frequency`);
  }

  return insights;
};

const getWeekContext = (db, weekNumber, year) => {
  return new Promise((resolve, reject) => {
    db.get(`
      SELECT
        COUNT(*) as trades_this_week,
        AVG(setup_quality) as avg_setup_quality,
        SUM(CASE WHEN executed = 1 THEN actual_pnl END) as week_pnl
      FROM trades
      WHERE week_number = ? AND year = ?
    `, [weekNumber, year], (err, row) => {
      if (err) reject(err);
      else resolve(row || { trades_this_week: 0, avg_setup_quality: 0, week_pnl: 0 });
    });
  });
};

const getBestPatternsForToday = (db) => {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT
        p.pattern_name,
        p.success_count,
        p.total_count,
        p.confidence_score,
        CASE
          WHEN p.total_count > 0 THEN (p.success_count * 1.0 / p.total_count)
          ELSE 0
        END as success_rate
      FROM patterns p
      WHERE p.total_count >= 2 AND p.confidence_score > 0.4
      ORDER BY success_rate DESC, confidence_score DESC
      LIMIT 3
    `, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
};

const generateTodayRecommendations = async (db, weekContext, bestPatterns) => {
  const recommendations = [];

  if (weekContext.trades_this_week >= 3) {
    recommendations.push({
      type: 'caution',
      message: 'Already at weekly trade limit - focus on quality over quantity',
      priority: 'high'
    });
  }

  bestPatterns.forEach((pattern, index) => {
    recommendations.push({
      type: 'pattern',
      pattern_name: pattern.pattern_name,
      message: `Look for ${pattern.pattern_name} setups - ${Math.round(pattern.success_rate * 100)}% success rate`,
      priority: index === 0 ? 'high' : 'medium',
      confidence: pattern.confidence_score
    });
  });

  const currentTime = new Date();
  const currentHour = currentTime.getHours();

  if (currentHour >= 9 && currentHour < 10) {
    recommendations.push({
      type: 'timing',
      message: 'Optimal trading window (9:30-10:15 AM) - prime time for scalping',
      priority: 'high'
    });
  } else if (currentHour < 9) {
    recommendations.push({
      type: 'timing',
      message: 'Pre-market preparation time - review overnight news and levels',
      priority: 'medium'
    });
  } else {
    recommendations.push({
      type: 'timing',
      message: 'Outside optimal trading window - consider waiting for next session',
      priority: 'low'
    });
  }

  return recommendations;
};

const getCurrentMarketConditions = (db) => {
  return new Promise((resolve, reject) => {
    resolve({
      session: 'opening',
      volatility: 'moderate',
      volume: 'above_average',
      trend: 'analyzing',
      conditions_favorable: true,
      risk_factors: []
    });
  });
};

// Execution patterns helper functions

const getExecutionPatterns = (db) => {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT
        pattern_type,
        frequency_count,
        success_rate,
        average_impact,
        confidence_score,
        first_seen,
        last_seen,
        coaching_priority,
        improvement_suggestion
      FROM execution_patterns
      WHERE trader_id = 'main_trader'
      ORDER BY frequency_count DESC, average_impact DESC
    `, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
};

const getDominantExecutionPatterns = (db) => {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT
        ep.pattern_type as type,
        ep.frequency_count as frequency,
        ep.average_impact as avg_impact,
        CASE
          WHEN ep.average_impact > 0 THEN 'improving'
          WHEN ep.average_impact < -0.1 THEN 'declining'
          ELSE 'stable'
        END as trend,
        ep.improvement_suggestion as coaching,
        ROUND((ep.frequency_count * 100.0 /
          (SELECT SUM(frequency_count) FROM execution_patterns WHERE trader_id = 'main_trader')), 1) as frequency_percentage
      FROM execution_patterns ep
      WHERE ep.trader_id = 'main_trader' AND ep.frequency_count >= 2
      ORDER BY ep.frequency_count DESC
      LIMIT 5
    `, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }

      const patterns = (rows || []).map(row => ({
        type: row.type,
        frequency: row.frequency_percentage || 0,
        avg_impact: Math.round((row.avg_impact || 0) * 100) / 100,
        trend: row.trend,
        coaching: row.coaching || `You exhibit ${row.type} behavior ${row.frequency_percentage || 0}% of the time`
      }));

      resolve(patterns);
    });
  });
};

const analyzeExecutionTrends = (db) => {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT
        ep.pattern_type,
        ep.frequency_count,
        ep.average_impact,
        COUNT(t.id) as recent_occurrences,
        AVG(t.entry_variance) as recent_avg_variance
      FROM execution_patterns ep
      LEFT JOIN trades t ON ep.pattern_type = 'early_entry'
        AND t.entry_variance > 2
        AND t.timestamp >= datetime('now', '-30 days')
      WHERE ep.trader_id = 'main_trader'
      GROUP BY ep.pattern_type
      ORDER BY ep.frequency_count DESC
    `, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }

      const trends = (rows || []).map(row => {
        let trendDirection = 'stable';
        if (row.recent_occurrences > row.frequency_count * 0.3) {
          trendDirection = 'increasing';
        } else if (row.recent_occurrences < row.frequency_count * 0.1) {
          trendDirection = 'decreasing';
        }

        return {
          pattern_type: row.pattern_type,
          trend_direction: trendDirection,
          recent_frequency: row.recent_occurrences || 0,
          historical_frequency: row.frequency_count || 0,
          recent_impact: Math.round((row.recent_avg_variance || 0) * 100) / 100
        };
      });

      resolve({
        overall_trend: calculateOverallExecutionTrend(trends),
        pattern_trends: trends,
        improvement_areas: identifyImprovementAreas(trends),
        strengths: identifyExecutionStrengths(trends)
      });
    });
  });
};

const calculateOverallExecutionTrend = (trends) => {
  const increasingCount = trends.filter(t => t.trend_direction === 'increasing').length;
  const decreasingCount = trends.filter(t => t.trend_direction === 'decreasing').length;

  if (increasingCount > decreasingCount) {
    return 'execution_consistency_declining';
  } else if (decreasingCount > increasingCount) {
    return 'execution_consistency_improving';
  } else {
    return 'execution_consistency_stable';
  }
};

const identifyImprovementAreas = (trends) => {
  const areas = [];

  const earlyEntryTrend = trends.find(t => t.pattern_type === 'early_entry');
  if (earlyEntryTrend && earlyEntryTrend.trend_direction === 'increasing') {
    areas.push('Entry timing discipline needs attention');
  }

  const lateEntryTrend = trends.find(t => t.pattern_type === 'late_entry');
  if (lateEntryTrend && lateEntryTrend.recent_frequency > 3) {
    areas.push('Set up better alert systems for entry levels');
  }

  return areas;
};

const identifyExecutionStrengths = (trends) => {
  const strengths = [];

  const stopTighteningTrend = trends.find(t => t.pattern_type === 'stop_tightening');
  if (stopTighteningTrend && stopTighteningTrend.trend_direction === 'increasing') {
    strengths.push('Improving risk management through stop tightening');
  }

  const targetExtensionTrend = trends.find(t => t.pattern_type === 'target_extension');
  if (targetExtensionTrend && targetExtensionTrend.recent_impact > 0) {
    strengths.push('Good momentum reading skills for target extensions');
  }

  return strengths;
};

const generateExecutionCoachingInsights = (dominantPatterns) => {
  const insights = [];

  dominantPatterns.forEach(pattern => {
    switch (pattern.type) {
      case 'early_entry':
        insights.push({
          pattern: pattern.type,
          frequency: `${pattern.frequency}% of trades`,
          impact: `${pattern.avg_impact} average R:R impact`,
          coaching: 'Practice waiting for complete pullback before entry trigger',
          priority: 'high'
        });
        break;

      case 'stop_tightening':
        insights.push({
          pattern: pattern.type,
          frequency: `${pattern.frequency}% of trades`,
          impact: `${pattern.avg_impact} average R:R impact`,
          coaching: pattern.avg_impact > 0
            ? 'Good risk management - continue tightening stops when appropriate'
            : 'Balance stop tightening with giving trades room to work',
          priority: 'medium'
        });
        break;

      case 'target_extension':
        insights.push({
          pattern: pattern.type,
          frequency: `${pattern.frequency}% of trades`,
          impact: `${pattern.avg_impact} average R:R impact`,
          coaching: 'Strong momentum reading skills - continue extending targets with conviction',
          priority: 'low'
        });
        break;

      default:
        insights.push({
          pattern: pattern.type,
          frequency: `${pattern.frequency}% of trades`,
          impact: `${pattern.avg_impact} average R:R impact`,
          coaching: pattern.coaching || 'Continue monitoring this execution pattern',
          priority: 'medium'
        });
    }
  });

  return insights;
};

module.exports = router;