# Ghost Journal - AI Trading Coach Backend

A personal AI-powered trading analysis system designed specifically for MNQ futures scalping and 5-year wealth building journey.

## 🎯 Project Overview

**Ghost Journal** is a highly personalized trading coach system that helps track and optimize MNQ (Micro NQ Futures) scalping performance over a 5-year wealth building journey from $500 to $951,000.

### Trading Profile
- **Instrument:** MNQ (Micro NQ Futures)
- **Strategy:** Opening session scalping (9:30-10:15 AM EST)
- **Target:** 0.75% weekly returns through 2-3 trades per week
- **Risk Management:** Maximum $50 per trade (1% account risk rule)
- **Timeline:** 5-year journey ($500 → $951,000)

## 🚀 Features

### Core Functionality
- **AI Screenshot Analysis:** Upload trading screenshots for Claude-powered analysis
- **Progress Tracking:** Monitor 5-year wealth building progress with projections
- **Pattern Learning:** Identify and learn from successful trading patterns
- **Risk Management:** Automated risk validation and alerts system
- **Personalized Coaching:** Context-aware AI insights based on trading history

### API Endpoints

#### Trading Analysis
- `POST /api/upload-trade` - Upload and analyze trading screenshots
- `POST /api/trade/:tradeId/outcome` - Update trade execution results
- `GET /api/trade/:tradeId` - Retrieve specific trade analysis

#### Progress Tracking
- `GET /api/progress` - Current progress toward 5-year goal
- `POST /api/progress/update-balance` - Update account balance
- `GET /api/progress/weekly/:year/:week` - Weekly performance data
- `GET /api/progress/projection` - Detailed 5-year projections

#### Pattern Learning
- `GET /api/patterns` - Trading pattern analysis and recommendations
- `GET /api/patterns/:patternName` - Detailed pattern performance
- `POST /api/patterns/learn` - Update pattern learning data
- `GET /api/patterns/analysis/correlation` - Pattern correlation analysis
- `GET /api/patterns/recommendations/today` - Daily pattern recommendations

#### Risk Management
- `GET /api/alerts` - Risk management alerts
- `POST /api/alerts/:alertId/acknowledge` - Acknowledge risk alerts
- `GET /api/risk-check` - Current risk assessment
- `POST /api/risk-check/manual` - Manual trade risk assessment
- `GET /api/violations` - Risk violation analysis

## 🛠️ Tech Stack

- **Backend:** Node.js, Express.js
- **Database:** SQLite (local development and production)
- **AI Integration:** Anthropic Claude API for screenshot analysis
- **File Upload:** Multer for screenshot handling
- **Deployment:** Vercel
- **Security:** Helmet, CORS, Rate limiting

## 📦 Installation

1. **Clone and install dependencies:**
   ```bash
   npm install
   ```

2. **Set up environment variables:**
   ```bash
   cp .env.example .env
   # Edit .env with your settings
   ```

3. **Required Environment Variables:**
   ```
   ANTHROPIC_API_KEY=your_anthropic_api_key_here
   PORT=3001
   NODE_ENV=development
   DB_PATH=./database/ghost_journal.db
   MAX_RISK_PER_TRADE=50
   TARGET_WEEKLY_RETURN=0.0075
   MAX_TRADES_PER_WEEK=3
   ```

4. **Run the development server:**
   ```bash
   npm run dev
   ```

## 🚢 Deployment

### Vercel Deployment

1. **Install Vercel CLI:**
   ```bash
   npm install -g vercel
   ```

2. **Deploy:**
   ```bash
   vercel
   ```

3. **Set environment variables in Vercel dashboard:**
   - Add your `ANTHROPIC_API_KEY`
   - Configure other production environment variables

## 📊 Database Schema

### Tables
- **trades** - Trading analysis records and outcomes
- **progress** - Weekly progress tracking toward 5-year goal
- **patterns** - Pattern recognition and learning data
- **account_snapshots** - Account balance history
- **risk_alerts** - Risk management violations and alerts

## 🔐 Security Features

- **Rate Limiting:** API calls limited to prevent abuse
- **File Validation:** Screenshot uploads validated for type and size
- **CORS Protection:** Configured for production domains
- **Helmet Security:** Standard security headers
- **Input Validation:** All API inputs validated

## 🧠 AI Analysis Features

### Claude Integration
The system uses Claude API for sophisticated screenshot analysis including:

- **Setup Quality Assessment** (1-10 rating)
- **Risk/Reward Analysis** with calculated ratios
- **Pattern Recognition** (8 different setup types)
- **Entry/Exit Quality Evaluation**
- **Compliance Checking** against risk rules
- **Learning Insights** referencing historical patterns
- **Execution Recommendations** (EXECUTE/WAIT/SKIP)

### Pattern Types Recognized
- Opening Breakout
- Volume Spike
- Pullback Entry
- Range Break
- Momentum Continuation
- Reversal Pattern
- Gap Fill
- Premarket Setup

## 📈 Progress Tracking

### 5-Year Plan Integration
- **Phase 1:** $500 → $50K (via $1,750/week deposits)
- **Phase 2:** $50K → $951K (via $750/week deposits + trading gains)
- **Weekly Targets:** 0.75% return through 2-3 trades
- **Risk Management:** 1% account risk rule ($50 max per trade)

### Projection Calculations
- Conservative, realistic, and optimistic scenarios
- Monte Carlo-style projections based on historical performance
- Risk assessment and success probability calculations
- Milestone tracking and achievement notifications

## 🛡️ Risk Management

### Automated Checks
- **Position Size Limits:** $50 maximum risk per trade
- **Frequency Limits:** Maximum 3 trades per week
- **Session Timing:** 9:30-10:15 AM EST optimal window
- **Risk/Reward Ratios:** Minimum 2:1 target enforcement

### Alert System
- Real-time risk violation notifications
- Severity-based alert categorization (HIGH/MEDIUM/LOW)
- Pattern-based risk assessment
- Historical violation analysis and recommendations

## 🔧 Development

### Local Development
```bash
npm run dev
```

### Testing
```bash
npm test
```

### Code Structure
```
src/
├── routes/          # API endpoint definitions
├── middleware/      # Express middleware (auth, validation, etc.)
├── models/          # Database models and schema
├── services/        # External service integrations (Claude API)
├── utils/           # Utility functions and helpers
└── logs/            # Application logs (auto-created)
```

## 📝 Usage Examples

### Upload Trading Screenshot
```javascript
const formData = new FormData();
formData.append('screenshot', file);

fetch('/api/upload-trade', {
  method: 'POST',
  body: formData
}).then(response => response.json())
  .then(data => console.log(data.analysis));
```

### Check Current Progress
```javascript
fetch('/api/progress')
  .then(response => response.json())
  .then(data => {
    console.log('Current balance:', data.current_account_balance);
    console.log('Weekly progress:', data.weekly_performance);
    console.log('5-year projection:', data.five_year_projection);
  });
```

### Get Pattern Recommendations
```javascript
fetch('/api/patterns/recommendations/today')
  .then(response => response.json())
  .then(data => {
    console.log('Recommended patterns:', data.recommended_patterns);
    console.log('Market conditions:', data.market_conditions);
  });
```

## 📞 Support

This is a personal trading system. For issues or enhancements, review the code and make modifications as needed for your specific trading approach.

## ⚠️ Disclaimer

This system is for educational and personal use only. Trading involves risk of loss. Past performance does not guarantee future results. Always practice proper risk management and never risk more than you can afford to lose.

## 📄 License

MIT License - Personal use only.