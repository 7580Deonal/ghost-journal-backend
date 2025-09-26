# Ghost Journal Backend - Deployment Guide

## ✅ Pre-Deployment Checklist

### Environment Setup
- [ ] Set `ANTHROPIC_API_KEY` in production environment
- [ ] Configure `NODE_ENV=production`
- [ ] Update CORS origins for production domains
- [ ] Set appropriate rate limits for production

### Required Environment Variables
```bash
ANTHROPIC_API_KEY=sk-your-actual-key-here
NODE_ENV=production
DB_PATH=./database/ghost_journal.db
MAX_RISK_PER_TRADE=50
TARGET_WEEKLY_RETURN=0.0075
MAX_TRADES_PER_WEEK=3
STARTING_CAPITAL=500
TARGET_CAPITAL=951000
WEEKLY_DEPOSIT_PHASE1=1750
WEEKLY_DEPOSIT_PHASE2=750
PHASE1_TARGET=50000
```

## 🚀 Vercel Deployment Steps

1. **Install Vercel CLI:**
   ```bash
   npm install -g vercel
   ```

2. **Login to Vercel:**
   ```bash
   vercel login
   ```

3. **Deploy:**
   ```bash
   vercel --prod
   ```

4. **Set Environment Variables:**
   - Go to Vercel Dashboard → Project Settings → Environment Variables
   - Add all required environment variables
   - Especially important: `ANTHROPIC_API_KEY`

## 📊 Database Considerations

### SQLite in Production
- Database is created automatically on first run
- Located at `./database/ghost_journal.db`
- For persistent data in Vercel, consider upgrading to PostgreSQL
- Current setup works for single-user personal system

### Database Migration (if needed)
```bash
# Backup current database
cp database/ghost_journal.db database/backup-$(date +%Y%m%d).db

# Database will auto-initialize on deployment
```

## 🔒 Security Configuration

### Production Security Headers
Already configured in `server.js`:
- Helmet for security headers
- CORS for cross-origin requests
- Rate limiting (100 requests per 15 minutes)
- File upload restrictions (10MB max)

### API Key Security
- Never commit real API keys to git
- Use Vercel environment variables
- Rotate keys if compromised

## 📁 File Upload Storage

### Current Setup (Local Storage)
- Files stored in `./uploads/` directory
- Organized by date (YYYY-MM-DD folders)
- Works for single-server deployment

### For Scale (Future Enhancement)
Consider upgrading to:
- Vercel Blob Storage
- AWS S3
- Cloudinary

## 🔍 Monitoring & Logging

### Production Logging
- Logs stored in `./logs/` directory
- Daily log rotation
- JSON formatted for easy parsing
- Automatic cleanup (30-day retention)

### Health Monitoring
- Health check endpoint: `GET /api/health`
- Monitor response times
- Track Claude API success rates

## 🧪 Testing Production Deployment

### Basic Health Checks
```bash
# Health check
curl https://your-domain.vercel.app/api/health

# Progress endpoint
curl https://your-domain.vercel.app/api/progress

# Patterns endpoint
curl https://your-domain.vercel.app/api/patterns
```

### Upload Test (with real screenshot)
```bash
curl -X POST https://your-domain.vercel.app/api/upload-trade \
  -F "screenshot=@test-screenshot.png"
```

## 📈 Performance Optimization

### Current Optimizations
- Single database connection per request
- Efficient SQL queries with indexes
- File validation before processing
- Request timeout handling

### Production Recommendations
- Monitor Claude API latency
- Add request caching for patterns
- Implement database connection pooling if scaling

## 🔄 Maintenance Tasks

### Weekly Tasks
- Check log files for errors
- Monitor database size growth
- Review risk alert patterns
- Validate 5-year projection accuracy

### Monthly Tasks
- Database backup
- Log cleanup verification
- API key rotation (if needed)
- Performance metrics review

## 🆘 Troubleshooting

### Common Issues

**1. Claude API Errors**
```
Error: Invalid Anthropic API key
```
Solution: Verify `ANTHROPIC_API_KEY` in environment variables

**2. Database Connection Issues**
```
Error: SQLITE_CANTOPEN: unable to open database file
```
Solution: Check file permissions and directory structure

**3. File Upload Failures**
```
Error: LIMIT_FILE_SIZE
```
Solution: Verify file size under 10MB, correct MIME type

**4. Rate Limit Exceeded**
```
Error: Too many requests from this IP
```
Solution: Implement authentication or increase rate limits

### Debug Mode
Set `NODE_ENV=development` for detailed error messages and debug logs.

## 📞 Support

For deployment issues:
1. Check Vercel deployment logs
2. Review application logs in `/logs/` directory
3. Verify all environment variables are set
4. Test individual endpoints with curl

Remember: This is a personal trading system. Keep your API keys secure and monitor your usage carefully.

## 🎯 Post-Deployment Verification

Once deployed, verify:
- [ ] Health endpoint responds correctly
- [ ] Database initializes with default patterns
- [ ] Progress tracking shows initial $500 balance
- [ ] Error handling returns proper JSON responses
- [ ] File upload validation works
- [ ] Claude API integration responds (with valid key)
- [ ] Logging system creates daily log files
- [ ] All endpoints return expected JSON structure

Your Ghost Journal AI Trading Coach backend is now ready to help you achieve your 5-year trading goals!