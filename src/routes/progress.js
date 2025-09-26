const express = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { getDatabase, getWeekNumber } = require('../models/database');

const router = express.Router();

router.get('/progress',
  asyncHandler(async (req, res) => {
    const db = getDatabase();
    const currentDate = new Date();
    const currentWeek = getWeekNumber(currentDate);
    const currentYear = currentDate.getFullYear();

    try {
      const progressData = await getProgressData(db, currentWeek, currentYear);
      const fiveYearProjection = calculateFiveYearProjection(progressData);

      res.json({
        success: true,
        data: {
          current_account_balance: progressData.currentBalance,
          weekly_performance: {
            current_week_trades: progressData.weekTrades,
            current_week_pnl_percentage: progressData.weekPnlPercent,
            target_progress: `${Math.round((progressData.weekPnlPercent / 0.75) * 100)}%`,
            remaining_trades: Math.max(0, 3 - progressData.weekTrades)
          },
          five_year_projection: fiveYearProjection,
          recent_milestones: await getRecentMilestones(db),
          next_milestone: await getNextMilestone(db, progressData.currentBalance),
          performance_metrics: await getPerformanceMetrics(db, currentWeek, currentYear)
        }
      });

    } catch (error) {
      console.error('Progress tracking error:', error);
      throw error;
    } finally {
      db.close();
    }
  })
);

router.post('/progress/update-balance',
  asyncHandler(async (req, res) => {
    const { balance, deposit_amount } = req.body;

    if (!balance || balance < 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid balance amount'
      });
    }

    const db = getDatabase();
    const currentDate = new Date();
    const currentWeek = getWeekNumber(currentDate);
    const currentYear = currentDate.getFullYear();

    try {
      await updateAccountBalance(db, balance, deposit_amount, currentWeek, currentYear);

      const snapshot = await createAccountSnapshot(db, balance, currentWeek, currentYear);

      res.json({
        success: true,
        message: 'Account balance updated successfully',
        data: {
          new_balance: balance,
          deposit_amount: deposit_amount || 0,
          snapshot_id: snapshot.id
        }
      });

    } catch (error) {
      console.error('Balance update error:', error);
      throw error;
    } finally {
      db.close();
    }
  })
);

router.get('/progress/weekly/:year/:week',
  asyncHandler(async (req, res) => {
    const { year, week } = req.params;
    const weekNum = parseInt(week);
    const yearNum = parseInt(year);

    if (!weekNum || !yearNum || weekNum < 1 || weekNum > 53) {
      return res.status(400).json({
        success: false,
        error: 'Invalid week or year parameters'
      });
    }

    const db = getDatabase();

    try {
      const weekData = await getWeeklyData(db, weekNum, yearNum);

      res.json({
        success: true,
        data: weekData
      });

    } catch (error) {
      console.error('Weekly progress error:', error);
      throw error;
    } finally {
      db.close();
    }
  })
);

router.get('/progress/projection',
  asyncHandler(async (req, res) => {
    const db = getDatabase();

    try {
      const currentProgress = await getCurrentProgressData(db);
      const detailedProjection = await generateDetailedProjection(db, currentProgress);

      res.json({
        success: true,
        data: detailedProjection
      });

    } catch (error) {
      console.error('Projection calculation error:', error);
      throw error;
    } finally {
      db.close();
    }
  })
);

const getProgressData = (db, weekNumber, year) => {
  return new Promise((resolve, reject) => {
    const query = `
      SELECT
        p.account_balance as currentBalance,
        p.week_pnl_percentage as weekPnlPercent,
        p.cumulative_pnl as totalPnl,
        COALESCE(t.weekTrades, 0) as weekTrades,
        COALESCE(t.avgSetupQuality, 0) as avgSetupQuality,
        p.weekly_deposit as weeklyDeposit
      FROM progress p
      LEFT JOIN (
        SELECT
          COUNT(*) as weekTrades,
          AVG(setup_quality) as avgSetupQuality
        FROM trades
        WHERE week_number = ? AND year = ? AND executed = 1
      ) t ON 1=1
      WHERE p.week_number = ? AND p.year = ?
      ORDER BY p.date DESC
      LIMIT 1
    `;

    db.get(query, [weekNumber, year, weekNumber, year], (err, row) => {
      if (err) {
        reject(err);
        return;
      }

      if (!row) {
        db.get('SELECT account_balance FROM progress ORDER BY date DESC LIMIT 1', (err, latestRow) => {
          if (err) {
            reject(err);
            return;
          }

          resolve({
            currentBalance: latestRow?.account_balance || 500,
            weekPnlPercent: 0,
            totalPnl: 0,
            weekTrades: 0,
            avgSetupQuality: 0,
            weeklyDeposit: 1750
          });
        });
        return;
      }

      resolve({
        currentBalance: row.currentBalance || 500,
        weekPnlPercent: row.weekPnlPercent || 0,
        totalPnl: row.totalPnl || 0,
        weekTrades: row.weekTrades || 0,
        avgSetupQuality: row.avgSetupQuality || 0,
        weeklyDeposit: row.weeklyDeposit || 1750
      });
    });
  });
};

const calculateFiveYearProjection = (progressData) => {
  const startDate = new Date('2025-01-01');
  const currentDate = new Date();
  const endDate = new Date('2030-01-01');

  const daysElapsed = Math.floor((currentDate - startDate) / (1000 * 60 * 60 * 24));
  const totalDays = Math.floor((endDate - startDate) / (1000 * 60 * 60 * 24));
  const monthsElapsed = Math.floor(daysElapsed / 30.44);

  const currentBalance = progressData.currentBalance;
  const targetBalance = 951000;

  const phase1Target = 50000;
  const phase = currentBalance >= phase1Target ? 2 : 1;

  const weeklyDepositPhase1 = 1750;
  const weeklyDepositPhase2 = 750;
  const targetWeeklyReturn = 0.75;

  let projectedBalance = currentBalance;
  let weeksRemaining = Math.floor((totalDays - daysElapsed) / 7);

  const weeklyDeposit = phase === 1 ? weeklyDepositPhase1 : weeklyDepositPhase2;
  const avgWeeklyReturn = progressData.weekPnlPercent || targetWeeklyReturn;

  for (let week = 0; week < weeksRemaining; week++) {
    projectedBalance += weeklyDeposit;
    projectedBalance *= (1 + avgWeeklyReturn / 100);
  }

  const trajectoryPercentage = ((projectedBalance - targetBalance) / targetBalance) * 100;

  return {
    months_elapsed: monthsElapsed,
    projected_final_balance: Math.round(projectedBalance),
    target_balance: targetBalance,
    current_trajectory: `${trajectoryPercentage > 0 ? '+' : ''}${Math.round(trajectoryPercentage)}%`,
    confidence_level: calculateConfidenceLevel(progressData),
    phase: phase,
    weeks_remaining: weeksRemaining,
    required_weekly_return: calculateRequiredWeeklyReturn(currentBalance, targetBalance, weeksRemaining, weeklyDeposit)
  };
};

const calculateConfidenceLevel = (progressData) => {
  let confidence = 0.5;

  if (progressData.weekTrades >= 2) confidence += 0.1;
  if (progressData.avgSetupQuality >= 7) confidence += 0.15;
  if (progressData.weekPnlPercent >= 0.5) confidence += 0.2;
  if (progressData.weekPnlPercent >= 0.75) confidence += 0.05;

  if (progressData.weekPnlPercent < 0) confidence -= 0.3;
  if (progressData.avgSetupQuality < 5) confidence -= 0.1;

  return Math.max(0.1, Math.min(1.0, confidence)) > 0.7 ? 'high' :
         Math.max(0.1, Math.min(1.0, confidence)) > 0.4 ? 'medium' : 'low';
};

const calculateRequiredWeeklyReturn = (currentBalance, targetBalance, weeksRemaining, weeklyDeposit) => {
  if (weeksRemaining <= 0) return 0;

  let balance = currentBalance;
  let requiredReturn = 0;

  for (let i = 0; i < 10; i++) {
    balance = currentBalance;
    const testReturn = requiredReturn;

    for (let week = 0; week < weeksRemaining; week++) {
      balance += weeklyDeposit;
      balance *= (1 + testReturn / 100);
    }

    if (Math.abs(balance - targetBalance) < 1000) break;

    if (balance < targetBalance) {
      requiredReturn += 0.1;
    } else {
      requiredReturn -= 0.05;
    }
  }

  return Math.max(0, Math.round(requiredReturn * 100) / 100);
};

const getRecentMilestones = (db) => {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT
        date,
        account_balance,
        cumulative_pnl
      FROM progress
      WHERE account_balance IN (
        SELECT DISTINCT account_balance
        FROM progress
        WHERE account_balance % 10000 = 0 OR account_balance % 5000 = 0
      )
      ORDER BY date DESC
      LIMIT 5
    `, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
};

const getNextMilestone = (db, currentBalance) => {
  return new Promise((resolve, reject) => {
    const milestones = [5000, 10000, 15000, 20000, 25000, 30000, 40000, 50000,
                      75000, 100000, 150000, 200000, 300000, 500000, 750000, 951000];

    const nextMilestone = milestones.find(milestone => milestone > currentBalance);

    if (!nextMilestone) {
      resolve({
        target: 951000,
        estimated_date: 'Target Achieved',
        trades_needed: 0,
        amount_needed: 0
      });
      return;
    }

    const amountNeeded = nextMilestone - currentBalance;
    const avgWeeklyGain = 0.75;
    const weeksNeeded = Math.ceil(amountNeeded / (currentBalance * (avgWeeklyGain / 100)));
    const estimatedDate = new Date();
    estimatedDate.setDate(estimatedDate.getDate() + (weeksNeeded * 7));

    const tradesNeeded = Math.ceil(weeksNeeded * 2.5);

    resolve({
      target: nextMilestone,
      estimated_date: estimatedDate.toISOString().split('T')[0],
      trades_needed: tradesNeeded,
      amount_needed: amountNeeded,
      weeks_needed: weeksNeeded
    });
  });
};

const getPerformanceMetrics = (db, weekNumber, year) => {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT
        COUNT(*) as total_trades,
        AVG(setup_quality) as avg_setup_quality,
        COUNT(CASE WHEN executed = 1 THEN 1 END) as executed_trades,
        COUNT(CASE WHEN executed = 1 AND actual_pnl > 0 THEN 1 END) as winning_trades,
        AVG(CASE WHEN executed = 1 THEN actual_pnl END) as avg_pnl_per_trade,
        SUM(CASE WHEN executed = 1 THEN actual_pnl END) as total_pnl
      FROM trades
      WHERE week_number = ? AND year = ?
    `, [weekNumber, year], (err, rows) => {
      if (err) {
        reject(err);
        return;
      }

      const metrics = rows[0] || {};
      const winRate = metrics.executed_trades > 0
        ? (metrics.winning_trades / metrics.executed_trades) * 100
        : 0;

      resolve({
        total_analyses: metrics.total_trades || 0,
        executed_trades: metrics.executed_trades || 0,
        win_rate: Math.round(winRate),
        avg_setup_quality: Math.round((metrics.avg_setup_quality || 0) * 10) / 10,
        avg_pnl_per_trade: Math.round((metrics.avg_pnl_per_trade || 0) * 100) / 100,
        total_week_pnl: Math.round((metrics.total_pnl || 0) * 100) / 100
      });
    });
  });
};

const updateAccountBalance = (db, balance, depositAmount, weekNumber, year) => {
  return new Promise((resolve, reject) => {
    db.get(`
      SELECT id FROM progress WHERE week_number = ? AND year = ?
    `, [weekNumber, year], (err, row) => {
      if (err) {
        reject(err);
        return;
      }

      if (row) {
        db.run(`
          UPDATE progress
          SET account_balance = ?, weekly_deposit = COALESCE(?, weekly_deposit)
          WHERE week_number = ? AND year = ?
        `, [balance, depositAmount, weekNumber, year], (err) => {
          if (err) reject(err);
          else resolve();
        });
      } else {
        db.run(`
          INSERT INTO progress (account_balance, weekly_deposit, week_number, year)
          VALUES (?, ?, ?, ?)
        `, [balance, depositAmount || 1750, weekNumber, year], (err) => {
          if (err) reject(err);
          else resolve();
        });
      }
    });
  });
};

const createAccountSnapshot = (db, balance, weekNumber, year) => {
  return new Promise((resolve, reject) => {
    const phase = balance >= 50000 ? 2 : 1;
    const targetProgress = (balance / 951000) * 100;
    const daysElapsed = Math.floor((new Date() - new Date('2025-01-01')) / (1000 * 60 * 60 * 24));

    db.run(`
      INSERT INTO account_snapshots (
        balance, phase, target_progress_percentage, days_elapsed, projection_status
      ) VALUES (?, ?, ?, ?, ?)
    `, [
      balance,
      phase,
      Math.round(targetProgress * 100) / 100,
      daysElapsed,
      balance > 951000 ? 'TARGET_EXCEEDED' : balance >= 500000 ? 'ON_TRACK_ADVANCED' : 'ON_TRACK'
    ], function(err) {
      if (err) reject(err);
      else resolve({ id: this.lastID });
    });
  });
};

const getWeeklyData = (db, weekNumber, year) => {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT
        t.*,
        p.account_balance,
        p.week_pnl_percentage,
        p.weekly_deposit
      FROM trades t
      LEFT JOIN progress p ON t.week_number = p.week_number AND t.year = p.year
      WHERE t.week_number = ? AND t.year = ?
      ORDER BY t.timestamp ASC
    `, [weekNumber, year], (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
};

const getCurrentProgressData = (db) => {
  return new Promise((resolve, reject) => {
    db.get(`
      SELECT
        account_balance,
        cumulative_pnl,
        (SELECT COUNT(*) FROM trades WHERE executed = 1) as total_executed_trades,
        (SELECT AVG(actual_pnl) FROM trades WHERE executed = 1 AND actual_pnl > 0) as avg_winning_trade
      FROM progress
      ORDER BY date DESC
      LIMIT 1
    `, (err, row) => {
      if (err) reject(err);
      else resolve(row || { account_balance: 500, cumulative_pnl: 0, total_executed_trades: 0, avg_winning_trade: 0 });
    });
  });
};

const generateDetailedProjection = async (db, currentData) => {
  const projections = {
    conservative: calculateScenario(currentData, 0.5),
    realistic: calculateScenario(currentData, 0.75),
    optimistic: calculateScenario(currentData, 1.0)
  };

  return {
    current_status: currentData,
    scenarios: projections,
    risk_assessment: generateRiskAssessment(currentData),
    recommendations: generateRecommendations(currentData, projections)
  };
};

const calculateScenario = (currentData, weeklyReturnPercent) => {
  const weeksRemaining = 260;
  const currentBalance = currentData.account_balance;
  const phase = currentBalance >= 50000 ? 2 : 1;
  const weeklyDeposit = phase === 1 ? 1750 : 750;

  let balance = currentBalance;
  const monthlySnapshots = [];

  for (let week = 0; week < weeksRemaining; week++) {
    balance += weeklyDeposit;
    balance *= (1 + weeklyReturnPercent / 100);

    if (week % 4 === 0) {
      monthlySnapshots.push({
        month: Math.floor(week / 4) + 1,
        balance: Math.round(balance),
        phase: balance >= 50000 ? 2 : 1
      });
    }
  }

  return {
    final_balance: Math.round(balance),
    monthly_snapshots: monthlySnapshots.slice(0, 60),
    success_probability: balance >= 951000 ? 'High' : balance >= 750000 ? 'Medium' : 'Low'
  };
};

const generateRiskAssessment = (currentData) => {
  const risks = [];

  if (currentData.total_executed_trades < 10) {
    risks.push({ risk: 'Limited trading history', severity: 'Medium', mitigation: 'Focus on consistent execution' });
  }

  if (currentData.avg_winning_trade < 0.3) {
    risks.push({ risk: 'Low average returns', severity: 'High', mitigation: 'Improve setup selection quality' });
  }

  return risks;
};

const generateRecommendations = (currentData, projections) => {
  const recommendations = [];

  if (projections.realistic.final_balance < 951000) {
    recommendations.push('Consider increasing weekly return target to 1.0%');
  }

  if (currentData.total_executed_trades < 50) {
    recommendations.push('Focus on building consistent trading rhythm');
  }

  return recommendations;
};

module.exports = router;