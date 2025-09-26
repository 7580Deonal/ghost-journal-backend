const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || './database/ghost_journal.db';

const createDatabaseDirectory = () => {
  const dbDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
};

const createTables = (db) => {
  return new Promise((resolve, reject) => {
    const trades_table = `
      CREATE TABLE IF NOT EXISTS trades (
        id TEXT PRIMARY KEY,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        screenshot_path TEXT,
        setup_quality REAL,
        risk_reward_ratio REAL,
        pattern_type TEXT,
        entry_quality TEXT,
        stop_placement TEXT,
        target_selection TEXT,
        ai_commentary TEXT,
        risk_amount REAL,
        within_limits BOOLEAN,
        session_timing TEXT,
        trade_frequency TEXT,
        learning_insights TEXT,
        recommendation TEXT,
        actual_outcome TEXT,
        actual_pnl REAL,
        executed BOOLEAN DEFAULT FALSE,
        week_number INTEGER,
        year INTEGER,
        -- Two-phase trading analysis fields
        trade_phase TEXT DEFAULT 'pre_trade',
        linked_execution_id TEXT,
        execution_upload_token TEXT,
        planned_entry REAL,
        planned_stop REAL,
        planned_target REAL,
        planned_rr REAL,
        actual_entry REAL,
        actual_stop REAL,
        actual_target REAL,
        actual_rr REAL,
        execution_timing TEXT,
        execution_quality_grade TEXT,
        price_variance_analysis TEXT,
        behavioral_observations TEXT,
        execution_coaching TEXT,
        trade_outcome TEXT,
        entry_variance REAL,
        stop_variance REAL,
        target_variance REAL,
        execution_screenshot_path TEXT,
        -- Universal timeframe support fields
        screenshots_metadata TEXT, -- JSON array of screenshot info
        timeframes_used TEXT, -- comma-separated custom timeframes
        trading_style TEXT DEFAULT 'mnq_scalping', -- 'mnq_scalping', 'swing', 'position', etc.
        analysis_specialization TEXT DEFAULT 'mnq_specialist', -- 'mnq_specialist', 'general', etc.
        analysis_completeness_score INTEGER DEFAULT 1,
        multi_timeframe_insights TEXT,
        trend_alignment_score REAL,
        structure_confirmation TEXT
      )
    `;

    const progress_table = `
      CREATE TABLE IF NOT EXISTS progress (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date DATE DEFAULT CURRENT_DATE,
        account_balance REAL,
        weekly_deposit REAL,
        trades_this_week INTEGER DEFAULT 0,
        week_pnl_percentage REAL DEFAULT 0,
        cumulative_pnl REAL DEFAULT 0,
        projection_variance REAL DEFAULT 0,
        week_number INTEGER,
        year INTEGER
      )
    `;

    const patterns_table = `
      CREATE TABLE IF NOT EXISTS patterns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pattern_name TEXT UNIQUE,
        success_count INTEGER DEFAULT 0,
        total_count INTEGER DEFAULT 0,
        avg_return REAL DEFAULT 0,
        last_seen DATE DEFAULT CURRENT_DATE,
        confidence_score REAL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `;

    const account_snapshots_table = `
      CREATE TABLE IF NOT EXISTS account_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        balance REAL,
        phase INTEGER,
        deposits_total REAL,
        trading_pnl REAL,
        target_progress_percentage REAL,
        days_elapsed INTEGER,
        projection_status TEXT
      )
    `;

    const risk_alerts_table = `
      CREATE TABLE IF NOT EXISTS risk_alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        trade_id TEXT,
        alert_type TEXT,
        message TEXT,
        severity TEXT,
        acknowledged BOOLEAN DEFAULT FALSE,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (trade_id) REFERENCES trades (id)
      )
    `;

    const execution_patterns_table = `
      CREATE TABLE IF NOT EXISTS execution_patterns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        trader_id TEXT DEFAULT 'main_trader',
        pattern_type TEXT,
        frequency_count INTEGER DEFAULT 1,
        success_rate REAL DEFAULT 0.0,
        average_impact REAL,
        confidence_score REAL,
        first_seen DATE DEFAULT CURRENT_DATE,
        last_seen DATE DEFAULT CURRENT_DATE,
        coaching_priority INTEGER DEFAULT 1,
        improvement_suggestion TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `;

    const coaching_effectiveness_table = `
      CREATE TABLE IF NOT EXISTS coaching_effectiveness (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pattern_type TEXT,
        suggestion_given TEXT,
        trades_since_suggestion INTEGER DEFAULT 0,
        improvement_observed BOOLEAN DEFAULT FALSE,
        effectiveness_score REAL DEFAULT 0.0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `;

    const screenshot_analysis_table = `
      CREATE TABLE IF NOT EXISTS screenshot_analysis (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        trade_id TEXT,
        screenshot_path TEXT,
        timeframe_label TEXT, -- user-defined: '1min', '4hr', 'daily', etc.
        timeframe_category TEXT, -- 'ultra_short', 'short_term', 'medium_term', 'long_term'
        timeframe_priority TEXT, -- 'entry_timing', 'structure', 'trend', 'bias'
        is_primary BOOLEAN DEFAULT FALSE, -- main timeframe for analysis focus
        individual_analysis TEXT,
        pattern_identified TEXT,
        trend_direction TEXT,
        key_levels TEXT, -- JSON array
        volume_analysis TEXT,
        confluence_score REAL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (trade_id) REFERENCES trades (id)
      )
    `;

    const user_settings_table = `
      CREATE TABLE IF NOT EXISTS user_settings (
        id INTEGER PRIMARY KEY DEFAULT 1,
        settings_json TEXT, -- JSON blob for all user settings
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `;

    db.serialize(() => {
      db.run(trades_table);
      db.run(progress_table);
      db.run(patterns_table);
      db.run(account_snapshots_table);
      db.run(risk_alerts_table);
      db.run(execution_patterns_table);
      db.run(coaching_effectiveness_table);
      db.run(screenshot_analysis_table);
      db.run(user_settings_table);

      db.run(`
        CREATE INDEX IF NOT EXISTS idx_trades_timestamp ON trades (timestamp);
      `);

      db.run(`
        CREATE INDEX IF NOT EXISTS idx_trades_week ON trades (year, week_number);
      `);

      db.run(`
        CREATE INDEX IF NOT EXISTS idx_progress_date ON progress (date);
      `);

      db.run(`
        CREATE INDEX IF NOT EXISTS idx_patterns_name ON patterns (pattern_name);
      `);

      db.run(`
        CREATE INDEX IF NOT EXISTS idx_trades_phase ON trades (trade_phase);
      `);

      db.run(`
        CREATE INDEX IF NOT EXISTS idx_trades_linked ON trades (linked_execution_id);
      `);

      db.run(`
        CREATE INDEX IF NOT EXISTS idx_execution_patterns_type ON execution_patterns (pattern_type);
      `);

      db.run(`
        CREATE INDEX IF NOT EXISTS idx_execution_patterns_trader ON execution_patterns (trader_id);
      `);

      db.run(`
        CREATE INDEX IF NOT EXISTS idx_screenshot_analysis_trade ON screenshot_analysis (trade_id);
      `);

      db.run(`
        CREATE INDEX IF NOT EXISTS idx_screenshot_analysis_timeframe ON screenshot_analysis (timeframe_label);
      `);

      db.run(`
        CREATE INDEX IF NOT EXISTS idx_screenshot_analysis_category ON screenshot_analysis (timeframe_category);
      `);

      resolve();
    });
  });
};

const initializeDatabase = async () => {
  createDatabaseDirectory();

  const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
      console.error('Error opening database:', err);
      throw err;
    }
  });

  try {
    await createTables(db);
    console.log('📊 Database tables created successfully');

    await insertDefaultPatterns(db);
    console.log('🎯 Default trading patterns initialized');

    await insertInitialProgress(db);
    console.log('📈 Initial progress tracking setup complete');

  } catch (error) {
    console.error('Database initialization error:', error);
    throw error;
  }

  return db;
};

const insertDefaultPatterns = (db) => {
  return new Promise((resolve, reject) => {
    const defaultPatterns = [
      'opening_breakout',
      'volume_spike',
      'pullback_entry',
      'range_break',
      'momentum_continuation',
      'reversal_pattern',
      'gap_fill',
      'premarket_setup'
    ];

    const stmt = db.prepare(`
      INSERT OR IGNORE INTO patterns (pattern_name, confidence_score)
      VALUES (?, 0.5)
    `);

    defaultPatterns.forEach(pattern => {
      stmt.run(pattern);
    });

    stmt.finalize((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
};

const insertInitialProgress = (db) => {
  return new Promise((resolve, reject) => {
    const today = new Date();
    const weekNumber = getWeekNumber(today);
    const year = today.getFullYear();

    db.get(
      'SELECT COUNT(*) as count FROM progress WHERE date = date("now")',
      (err, row) => {
        if (err) {
          reject(err);
          return;
        }

        if (row.count === 0) {
          db.run(`
            INSERT INTO progress (
              date,
              account_balance,
              weekly_deposit,
              week_number,
              year
            ) VALUES (
              date("now"),
              ?,
              ?,
              ?,
              ?
            )
          `, [
            process.env.STARTING_CAPITAL || 500,
            process.env.WEEKLY_DEPOSIT_PHASE1 || 1750,
            weekNumber,
            year
          ], (err) => {
            if (err) reject(err);
            else resolve();
          });
        } else {
          resolve();
        }
      }
    );
  });
};

const getWeekNumber = (date) => {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
};

const getDatabase = () => {
  return new sqlite3.Database(DB_PATH);
};

module.exports = {
  initializeDatabase,
  getDatabase,
  getWeekNumber
};