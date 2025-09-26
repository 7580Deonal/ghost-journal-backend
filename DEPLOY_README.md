# Ghost Journal Backend - Deployment Guide

## 🚀 GitHub Repository Setup

### Step 1: Initialize Git Repository
```bash
# Navigate to your Ghost Journal directory
cd "C:\GHOST JOURNAL"

# Initialize git repository (if not already done)
git init

# Add all files to git
git add .

# Create initial commit
git commit -m "Initial commit: Ghost Journal AI Trading Coach Backend"
```

### Step 2: Create GitHub Repository
1. Go to [GitHub](https://github.com) and log in
2. Click "New repository" (green button)
3. Repository name: `ghost-journal-backend`
4. Description: `AI Trading Coach Backend for MNQ Scalping Analysis`
5. Make it **Private** (recommended for trading systems)
6. **DO NOT** initialize with README, .gitignore, or license (we already have these)
7. Click "Create repository"

### Step 3: Push Code to GitHub
```bash
# Add GitHub remote (replace YOUR_USERNAME with your GitHub username)
git remote add origin https://github.com/YOUR_USERNAME/ghost-journal-backend.git

# Push to GitHub
git branch -M main
git push -u origin main
```

## 📁 Complete File Structure

Your repository will contain:

```
ghost-journal-backend/
├── 📄 server.js                 # Main Express server
├── 📄 package.json              # Dependencies & scripts
├── 📄 package-lock.json         # Dependency lock file
├── 📄 vercel.json               # Vercel deployment config
├── 📄 .env.example              # Environment variables template
├── 📄 .gitignore                # Git ignore rules
├── 📄 README.md                 # Project documentation
├── 📄 DEPLOYMENT.md             # Deployment instructions
├── 📄 REVIEW_REPORT.md          # System review report
├── 📄 DEPLOY_README.md          # This deployment guide
├── 📁 src/
│   ├── 📁 middleware/
│   │   ├── errorHandler.js      # Async error handling
│   │   └── upload.js            # File upload middleware
│   ├── 📁 models/
│   │   └── database.js          # SQLite database schema
│   ├── 📁 routes/
│   │   ├── alerts.js            # Risk management endpoints
│   │   ├── frontend.js          # Frontend-specific routes
│   │   ├── patterns.js          # Pattern analysis endpoints
│   │   ├── progress.js          # Progress tracking endpoints
│   │   └── upload.js            # Screenshot analysis endpoints
│   ├── 📁 services/
│   │   ├── claudeAnalysis.js    # AI analysis service
│   │   ├── errorHandler.js      # Error handling utilities
│   │   └── mnqSpecialization.js # MNQ trading specialization
│   └── 📁 utils/
│       ├── logger.js            # Logging system
│       └── timeframeClassifier.js # Timeframe classification
├── 📁 database/
│   └── .gitkeep                 # Ensures directory is tracked
├── 📁 logs/
│   └── .gitkeep                 # Ensures directory is tracked
└── 📁 uploads/
    └── .gitkeep                 # Ensures directory is tracked
```

## 🔧 Vercel Deployment Steps

### Step 1: Install Vercel CLI (Optional)
```bash
npm install -g vercel
```

### Step 2: Deploy via GitHub (Recommended)
1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Click "New Project"
3. Import your GitHub repository `ghost-journal-backend`
4. Vercel will automatically detect it's a Node.js project
5. **Framework Preset**: None (Express.js)
6. **Root Directory**: ./
7. **Build Command**: Leave empty (not needed for Express)
8. **Output Directory**: Leave empty
9. **Install Command**: `npm install`

### Step 3: Configure Environment Variables in Vercel
In your Vercel project settings, add these environment variables:

```bash
# Required for AI Analysis
ANTHROPIC_API_KEY=your_actual_api_key_here

# Server Configuration
NODE_ENV=production
PORT=3001

# Database Configuration
DB_PATH=./database/ghost_journal.db

# File Upload Configuration
MAX_FILE_SIZE=10485760
ALLOWED_FILE_TYPES=image/png,image/jpeg,application/pdf

# Trading Configuration
MAX_RISK_PER_TRADE=50
TARGET_WEEKLY_RETURN=0.0075
TRADING_SESSION_START=09:30
TRADING_SESSION_END=10:15
MAX_TRADES_PER_WEEK=3

# 5-Year Plan Configuration
STARTING_CAPITAL=500
TARGET_CAPITAL=951000
WEEKLY_DEPOSIT_PHASE1=1750
WEEKLY_DEPOSIT_PHASE2=750
PHASE1_TARGET=50000
```

### Step 4: Deploy
1. Click "Deploy"
2. Vercel will build and deploy your application
3. You'll get a live URL like: `https://ghost-journal-backend.vercel.app`

## 🔑 Environment Variables Documentation

### Critical Variables (Required)
- **ANTHROPIC_API_KEY**: Your Claude API key from Anthropic Console
- **NODE_ENV**: Set to `production` for deployment

### Trading Configuration
- **MAX_RISK_PER_TRADE**: Maximum risk per trade in dollars (default: 50)
- **TARGET_WEEKLY_RETURN**: Target weekly return percentage (default: 0.0075 = 0.75%)
- **MAX_TRADES_PER_WEEK**: Maximum trades per week (default: 3)

### 5-Year Plan Variables
- **STARTING_CAPITAL**: Starting account balance (default: 500)
- **TARGET_CAPITAL**: 5-year target (default: 951000)
- **WEEKLY_DEPOSIT_PHASE1**: Weekly deposits phase 1 (default: 1750)
- **WEEKLY_DEPOSIT_PHASE2**: Weekly deposits phase 2 (default: 750)
- **PHASE1_TARGET**: Phase 1 target balance (default: 50000)

## ✅ Post-Deployment Testing

### Test Your Deployed API
1. **Health Check**: `GET https://your-app.vercel.app/api/health`
2. **Expected Response**:
```json
{
  "status": "healthy",
  "timestamp": "2025-01-XX...",
  "environment": "production"
}
```

### Test Upload Endpoint
```bash
curl -X POST https://your-app.vercel.app/api/upload-trade \
  -F "screenshot=@your-screenshot.png"
```

## 🔧 Alternative: Manual ZIP Creation

If you prefer to create a ZIP file manually:

### Files to Include:
1. **Root files**: server.js, package.json, package-lock.json, vercel.json, .env.example
2. **Documentation**: README.md, DEPLOYMENT.md, REVIEW_REPORT.md
3. **Source code**: Entire src/ directory with all subdirectories
4. **Configuration**: .gitignore
5. **Directory placeholders**: .gitkeep files in database/, logs/, uploads/

### Files to EXCLUDE:
- node_modules/ (will be installed during deployment)
- .env (contains secrets)
- database/*.db (will be created during runtime)
- logs/*.log (will be created during runtime)
- uploads/* (except .gitkeep)

## 🎯 Quick Start Commands

```bash
# 1. Initialize and commit
git init
git add .
git commit -m "Initial commit: Ghost Journal Backend"

# 2. Create GitHub repository and push
git remote add origin https://github.com/YOUR_USERNAME/ghost-journal-backend.git
git branch -M main
git push -u origin main

# 3. Deploy to Vercel
# Go to vercel.com → New Project → Import from GitHub

# 4. Set environment variables in Vercel dashboard

# 5. Deploy and test!
```

## 🆘 Troubleshooting

### Common Issues:
1. **Build fails**: Check package.json dependencies
2. **API calls fail**: Verify ANTHROPIC_API_KEY is set
3. **Database errors**: Ensure write permissions for database directory
4. **Upload fails**: Check file size limits and CORS settings

Your Ghost Journal backend is now ready for production deployment! 🚀