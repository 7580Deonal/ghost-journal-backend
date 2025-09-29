const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { upload, multiTimeframeUpload, universalTimeframeUpload, validateUploadedFile, validateMultiTimeframeUpload, validateUniversalTimeframeUpload, validateFrontendTimeframeUpload, cleanupMultiTimeframeFiles, getFileStats } = require('../middleware/upload');
const { determineTimeframeHierarchy, generateAnalysisStrategy, formatTimeframeMetadata } = require('../utils/timeframeClassifier');
const { provideMNQInsights } = require('../services/mnqSpecialization');
const { asyncHandler, validateTradingRules } = require('../middleware/errorHandler');
const { getDatabase, getWeekNumber } = require('../models/database');
const ClaudeAnalysisService = require('../services/claudeAnalysis');

const router = express.Router();
const claudeService = new ClaudeAnalysisService();

// Debug route to test if routes are working
router.get('/test', (req, res) => {
  res.json({
    success: true,
    message: 'Upload routes are working',
    timestamp: new Date().toISOString(),
    availableRoutes: [
      'POST /api/upload-trade',
      'POST /api/trades/upload',
      'POST /api/upload-trade-multi',
      'GET /api/test'
    ]
  });
});

// Debug middleware to log raw request details before multer
const debugRequest = (req, res, next) => {
  console.log('🔍 Raw request debug (before multer):', {
    method: req.method,
    contentType: req.get('Content-Type'),
    contentLength: req.get('Content-Length'),
    hasBody: !!req.body,
    bodyKeys: Object.keys(req.body || {}),
    hasFiles: !!req.files,
    hasFile: !!req.file,
    headers: {
      'content-type': req.get('Content-Type'),
      'content-length': req.get('Content-Length'),
      'content-disposition': req.get('Content-Disposition')
    }
  });
  next();
};

// Enhanced flexible upload handler that accepts any field name
const flexibleUpload = upload.any();

// Main upload endpoint (original)
router.post('/upload-trade',
  debugRequest,
  flexibleUpload,
  (req, res, next) => {
    console.log('📁 Post-multer debug:', {
      hasFiles: !!req.files,
      filesLength: req.files ? req.files.length : 0,
      hasFile: !!req.file,
      bodyKeys: Object.keys(req.body || {}),
      filesArray: req.files ? req.files.map(f => ({
        fieldname: f.fieldname,
        originalname: f.originalname,
        mimetype: f.mimetype,
        size: f.size,
        destination: f.destination,
        filename: f.filename,
        path: f.path
      })) : []
    });
    next();
  },
  validateUploadedFile,
  asyncHandler(async (req, res) => {
    const db = getDatabase();
    const tradeId = uuidv4();
    const timestamp = new Date();
    const weekNumber = getWeekNumber(timestamp);
    const year = timestamp.getFullYear();

    try {
      const tradeContext = await getTradeContext(db, weekNumber, year);
      const fileStats = getFileStats(req.file.path);

      let analysis;
      try {
        analysis = await claudeService.analyzeTradeScreenshot(
          req.file.path,
          tradeContext
        );
      } catch (claudeError) {
        if (claudeError.message.includes('API key') || claudeError.message.includes('authentication_error')) {
          console.log('⚠️ Using fallback analysis due to API key issue');
          analysis = createFallbackAnalysis(req.body.notes || '');
        } else {
          throw claudeError;
        }
      }

      const validationResults = validateTradingRules(analysis);

      // Generate execution upload token for linking
      const executionToken = `exec_${tradeId.substr(0, 8)}_${Date.now()}`;

      // Extract planned prices from analysis (Claude should provide these)
      const plannedPrices = extractPlannedPrices(analysis);

      const tradeRecord = {
        id: tradeId,
        timestamp: timestamp.toISOString(),
        screenshot_path: req.file.relativePath,
        ...analysis,
        week_number: weekNumber,
        year: year,
        trade_phase: 'pre_trade',
        execution_upload_token: executionToken,
        planned_entry: plannedPrices.entry,
        planned_stop: plannedPrices.stop,
        planned_target: plannedPrices.target,
        planned_rr: plannedPrices.risk_reward
      };

      await insertTradeRecord(db, tradeRecord);

      if (validationResults.errors.length > 0) {
        await insertRiskAlerts(db, tradeId, validationResults.errors);
      }

      await updatePatternCounts(db, analysis.pattern_type);

      const response = {
        trade_id: tradeId,
        timestamp: timestamp.toISOString(),
        trade_phase: 'pre_trade',
        file_info: {
          filename: req.file.filename,
          size: fileStats?.sizeReadable || 'Unknown',
          path: req.file.relativePath
        },
        pre_trade_analysis: {
          ...analysis,
          planned_prices: plannedPrices,
          compliance_check: {
            risk_amount: analysis.risk_amount,
            within_limits: analysis.within_limits,
            session_timing: analysis.session_timing,
            trade_frequency: `${tradeContext.tradesThisWeek + 1}_of_${process.env.MAX_TRADES_PER_WEEK || 3}_weekly`,
            validation_results: validationResults
          }
        },
        execution_flow: {
          awaiting_execution: true,
          execution_upload_token: executionToken,
          execution_upload_url: `/api/trade/${tradeId}/execution`,
          instructions: "Upload execution screenshot after trade completion to analyze execution quality"
        },
        context: {
          week_number: weekNumber,
          year: year,
          trades_this_week: tradeContext.tradesThisWeek,
          weekly_progress: tradeContext.weeklyProgress
        }
      };

      res.json({
        success: true,
        message: 'Trading screenshot analyzed successfully',
        data: response
      });

    } catch (error) {
      console.error('Upload analysis error:', error);

      await cleanupFailedUpload(req.file.path, tradeId);

      if (error.code === 'ANTHROPIC_API_ERROR') {
        return res.status(503).json({
          success: false,
          error: 'AI Analysis Failed',
          message: 'Unable to analyze screenshot. Please try again.',
          trade_id: tradeId
        });
      }

      throw error;
    } finally {
      db.close();
    }
  })
);

// Alternative route path for frontend compatibility (/api/trades/upload)
router.post('/trades/upload',
  (req, res, next) => {
    console.log('🎯 /api/trades/upload route HIT!', {
      method: req.method,
      path: req.path,
      originalUrl: req.originalUrl,
      contentType: req.get('Content-Type'),
      hasFiles: !!req.files,
      hasFile: !!req.file,
      bodyKeys: Object.keys(req.body || {})
    });
    next();
  },
  debugRequest,
  flexibleUpload,
  (req, res, next) => {
    console.log('📁 Post-multer debug (/trades/upload):', {
      hasFiles: !!req.files,
      filesLength: req.files ? req.files.length : 0,
      hasFile: !!req.file,
      bodyKeys: Object.keys(req.body || {}),
      filesArray: req.files ? req.files.map(f => ({
        fieldname: f.fieldname,
        originalname: f.originalname,
        mimetype: f.mimetype,
        size: f.size,
        destination: f.destination,
        filename: f.filename,
        path: f.path
      })) : [],
      multerError: req.multerError || 'none'
    });
    next();
  },
  validateUploadedFile,
  asyncHandler(async (req, res) => {
    console.log('📍 Processing upload in /api/trades/upload route');

    const db = getDatabase();
    const tradeId = uuidv4();
    const timestamp = new Date();
    const weekNumber = getWeekNumber(timestamp);
    const year = timestamp.getFullYear();

    console.log('📊 Upload processing started:', {
      tradeId,
      weekNumber,
      year,
      filePath: req.file?.path
    });

    try {
      const tradeContext = await getTradeContext(db, weekNumber, year);
      const fileStats = getFileStats(req.file.path);

      let analysis;
      try {
        analysis = await claudeService.analyzeTradeScreenshot(
          req.file.path,
          tradeContext
        );
      } catch (claudeError) {
        if (claudeError.message.includes('API key') || claudeError.message.includes('authentication_error')) {
          console.log('⚠️ Using fallback analysis due to API key issue');
          analysis = createFallbackAnalysis(req.body.notes || '');
        } else {
          throw claudeError;
        }
      }

      const validationResults = validateTradingRules(analysis);
      const executionToken = `exec_${tradeId.substr(0, 8)}_${Date.now()}`;
      const plannedPrices = extractPlannedPrices(analysis);

      const tradeRecord = {
        id: tradeId,
        timestamp: timestamp.toISOString(),
        screenshot_path: req.file.path,
        setup_quality: analysis.setup_quality,
        risk_reward_ratio: analysis.risk_reward_ratio,
        pattern_type: analysis.pattern_type,
        entry_quality: analysis.entry_quality,
        stop_placement: analysis.stop_placement,
        target_selection: analysis.target_selection,
        ai_commentary: analysis.ai_commentary,
        risk_amount: analysis.risk_amount,
        within_limits: validationResults.riskCompliant,
        session_timing: analysis.session_timing,
        trade_frequency: analysis.trade_frequency,
        learning_insights: analysis.learning_insights,
        recommendation: analysis.recommendation,
        week_number: weekNumber,
        year: year,
        execution_upload_token: executionToken,
        planned_entry: plannedPrices.entry,
        planned_stop: plannedPrices.stop,
        planned_target: plannedPrices.target,
        planned_rr: analysis.risk_reward_ratio,
        trading_style: 'mnq_scalping',
        analysis_specialization: 'mnq_specialist'
      };

      await insertTradeRecord(db, tradeRecord);
      await updatePatternStats(db, analysis.pattern_type);

      if (validationResults.violations.length > 0) {
        await createRiskAlerts(db, tradeId, validationResults.violations);
      }

      const response = {
        trade_id: tradeId,
        analysis: analysis,
        validation: validationResults,
        execution_token: executionToken,
        mnq_insights: provideMNQInsights(analysis),
        file_info: {
          size: fileStats?.size,
          uploaded_at: timestamp.toISOString()
        }
      };

      res.json({
        success: true,
        message: 'Trading screenshot analyzed successfully',
        data: response
      });

    } catch (error) {
      console.error('Upload analysis error:', error);

      await cleanupFailedUpload(req.file.path, tradeId);

      if (error.code === 'ANTHROPIC_API_ERROR') {
        return res.status(503).json({
          success: false,
          error: 'AI Analysis Failed',
          message: 'Unable to analyze screenshot. Please try again.',
          trade_id: tradeId
        });
      }

      throw error;
    } finally {
      db.close();
    }
  })
);

// Multi-timeframe upload endpoint
router.post('/upload-trade-multi',
  multiTimeframeUpload.fields([
    { name: '1min', maxCount: 1 },
    { name: '5min', maxCount: 1 },
    { name: '15min', maxCount: 1 },
    { name: 'daily', maxCount: 1 }
  ]),
  validateMultiTimeframeUpload,
  asyncHandler(async (req, res) => {
    const db = getDatabase();
    const tradeId = req.tradeId || uuidv4();
    const timestamp = new Date();
    const weekNumber = getWeekNumber(timestamp);
    const year = timestamp.getFullYear();

    try {
      const tradeContext = await getTradeContext(db, weekNumber, year);
      const timeframes = req.timeframesUploaded;

      // Analyze with Claude using multi-timeframe approach
      let analysis;
      try {
        analysis = await claudeService.analyzeMultiTimeframeScreenshots(
          req.files,
          tradeContext
        );
      } catch (claudeError) {
        if (claudeError.message.includes('API key') || claudeError.message.includes('authentication_error')) {
          console.log('⚠️ Using fallback multi-timeframe analysis due to API key issue');
          analysis = createFallbackMultiTimeframeAnalysis(timeframes, req.body.notes || '');
        } else {
          throw claudeError;
        }
      }

      const validationResults = validateTradingRules(analysis);

      // Generate execution upload token
      const executionToken = `exec_${tradeId.substr(0, 8)}_${Date.now()}`;

      // Extract planned prices
      const plannedPrices = extractPlannedPrices(analysis);

      // Create timeframe file paths object
      const timeframePaths = {};
      for (const timeframe of timeframes) {
        const file = req.files[timeframe][0];
        timeframePaths[`screenshot_${timeframe}`] = file.relativePath;
      }

      // Store individual timeframe analysis
      for (const timeframe of timeframes) {
        const file = req.files[timeframe][0];
        const individualAnalysis = analysis.individual_timeframe_analysis[timeframe] || {};

        await insertTimeframeAnalysis(db, {
          trade_id: tradeId,
          timeframe: timeframe,
          screenshot_path: file.relativePath,
          individual_analysis: JSON.stringify(individualAnalysis),
          pattern_identified: individualAnalysis.pattern_identified || 'unknown',
          trend_direction: individualAnalysis.trend_direction || 'neutral',
          key_levels: JSON.stringify(individualAnalysis.key_levels || []),
          volume_analysis: individualAnalysis.volume_analysis || 'no volume analysis',
          confluence_score: individualAnalysis.individual_setup_score || 5
        });
      }

      const tradeRecord = {
        id: tradeId,
        timestamp: timestamp.toISOString(),
        screenshot_path: req.files['1min'][0].relativePath, // Primary screenshot
        ...analysis,
        week_number: weekNumber,
        year: year,
        trade_phase: 'pre_trade',
        execution_upload_token: executionToken,
        planned_entry: plannedPrices.entry,
        planned_stop: plannedPrices.stop,
        planned_target: plannedPrices.target,
        planned_rr: plannedPrices.risk_reward,
        // Multi-timeframe fields
        ...timeframePaths,
        timeframes_uploaded: timeframes.join(','),
        analysis_completeness_score: analysis.completeness_score || analysis.timeframes_analyzed?.length || 1,
        multi_timeframe_insights: analysis.multi_timeframe_insights || 'Multi-timeframe analysis completed',
        trend_alignment_score: analysis.trend_alignment_score || 0.5,
        structure_confirmation: analysis.structure_confirmation || 'Structure analysis completed'
      };

      await insertMultiTimefradeRecord(db, tradeRecord);

      if (validationResults.errors.length > 0) {
        await insertRiskAlerts(db, tradeId, validationResults.errors);
      }

      await updatePatternCounts(db, analysis.pattern_type);

      const response = {
        trade_id: tradeId,
        timestamp: timestamp.toISOString(),
        trade_phase: 'pre_trade',
        analysis_type: 'multi_timeframe',
        timeframes_analyzed: timeframes,
        completeness_score: analysis.completeness_score,
        file_info: {
          timeframes: timeframes.reduce((acc, tf) => {
            const file = req.files[tf][0];
            acc[tf] = {
              filename: file.filename,
              size: getFileStats(file.path)?.sizeReadable || 'Unknown',
              path: file.relativePath
            };
            return acc;
          }, {})
        },
        multi_timeframe_analysis: {
          individual_analysis: analysis.individual_timeframe_analysis,
          cross_timeframe_confluence: analysis.cross_timeframe_analysis,
          ...analysis,
          planned_prices: plannedPrices,
          compliance_check: {
            risk_amount: analysis.risk_amount,
            within_limits: analysis.within_limits,
            session_timing: analysis.session_timing,
            trade_frequency: `${tradeContext.tradesThisWeek + 1}_of_${process.env.MAX_TRADES_PER_WEEK || 3}_weekly`,
            validation_results: validationResults
          }
        },
        execution_flow: {
          awaiting_execution: true,
          execution_upload_token: executionToken,
          execution_upload_url: `/api/trade/${tradeId}/execution`,
          instructions: "Upload execution screenshot after trade completion to analyze execution quality"
        },
        context: {
          week_number: weekNumber,
          year: year,
          trades_this_week: tradeContext.tradesThisWeek,
          weekly_progress: tradeContext.weeklyProgress
        }
      };

      res.json({
        success: true,
        message: 'Multi-timeframe trading analysis completed successfully',
        data: response
      });

    } catch (error) {
      console.error('Multi-timeframe upload analysis error:', error);

      await cleanupFailedMultiTimeframeUpload(req.files, tradeId);

      if (error.code === 'ANTHROPIC_API_ERROR') {
        return res.status(503).json({
          success: false,
          error: 'AI Analysis Failed',
          message: 'Unable to analyze multi-timeframe screenshots. Please try again.',
          trade_id: tradeId
        });
      }

      throw error;
    } finally {
      db.close();
    }
  })
);

// Universal timeframe upload endpoint with flexible timeframe support
router.post('/upload-trade-universal',
  universalTimeframeUpload.any(), // Accept any field names as timeframes
  validateUniversalTimeframeUpload,
  asyncHandler(async (req, res) => {
    const db = getDatabase();
    const tradeId = req.tradeId || uuidv4();
    const timestamp = new Date();
    const weekNumber = getWeekNumber(timestamp);
    const year = timestamp.getFullYear();

    try {
      const tradeContext = await getTradeContext(db, weekNumber, year);
      const timeframes = req.timeframesUploaded;
      const tradingContext = req.tradingContext;

      // Create timeframe objects for hierarchy analysis
      const timeframeObjects = timeframes.map(tf => ({
        timeframe_label: tf,
        is_primary: tf === tradingContext.primary_timeframe
      }));

      // Determine timeframe hierarchy and generate analysis strategy
      const hierarchyData = determineTimeframeHierarchy(timeframeObjects);
      const analysisStrategy = generateAnalysisStrategy(hierarchyData, tradingContext.trading_style);

      // Get MNQ specialization insights if applicable
      const mnqInsights = provideMNQInsights(hierarchyData, tradingContext);

      // Analyze with Claude using universal timeframe approach
      let analysis;
      try {
        analysis = await claudeService.analyzeUniversalTimeframeScreenshots(
          req.files,
          tradingContext,
          hierarchyData
        );
      } catch (claudeError) {
        if (claudeError.message.includes('API key') || claudeError.message.includes('authentication_error')) {
          console.log('⚠️ Using fallback universal analysis due to API key issue');
          analysis = createFallbackUniversalAnalysis(timeframes, tradingContext, hierarchyData, req.body.notes || '');
        } else {
          throw claudeError;
        }
      }

      // Apply MNQ specialization adjustments to analysis
      if (mnqInsights) {
        analysis.confidence_score = Math.min(1.0, analysis.confidence_score * mnqInsights.confidence_multiplier);
        analysis.completeness_score = Math.min(100, analysis.completeness_score + (mnqInsights.overall_assessment === 'excellent' ? 5 : 0));
        analysis.specialized_insights = { ...analysis.specialized_insights, ...mnqInsights };
      }

      const validationResults = validateTradingRules(analysis);

      // Generate execution upload token
      const executionToken = `exec_${tradeId.substr(0, 8)}_${Date.now()}`;

      // Extract planned prices
      const plannedPrices = extractPlannedPrices(analysis);

      // Format timeframe metadata for database storage
      const timeframeMetadata = formatTimeframeMetadata(req.files, hierarchyData);

      // Store individual screenshot analysis
      for (const timeframe of timeframes) {
        const file = req.files[timeframe][0];
        const individualAnalysis = analysis.individual_timeframe_analysis[timeframe] || {};
        const classification = hierarchyData.classified_timeframes.find(tf => tf.timeframe_label === timeframe);

        await insertUniversalScreenshotAnalysis(db, {
          trade_id: tradeId,
          screenshot_path: file.relativePath,
          timeframe_label: timeframe,
          timeframe_category: classification?.classification.category || 'unknown',
          timeframe_priority: classification?.classification.priority || 'context',
          is_primary: timeframe === tradingContext.primary_timeframe,
          individual_analysis: JSON.stringify(individualAnalysis),
          pattern_identified: individualAnalysis.pattern_identified || 'unknown',
          trend_direction: individualAnalysis.trend_direction || 'neutral',
          key_levels: JSON.stringify(individualAnalysis.key_levels || []),
          volume_analysis: individualAnalysis.volume_analysis || 'no analysis available',
          confluence_score: individualAnalysis.setup_quality || 5
        });
      }

      const tradeRecord = {
        id: tradeId,
        timestamp: timestamp.toISOString(),
        screenshot_path: req.files[tradingContext.primary_timeframe][0].relativePath, // Primary screenshot
        ...analysis,
        week_number: weekNumber,
        year: year,
        trade_phase: 'pre_trade',
        execution_upload_token: executionToken,
        planned_entry: plannedPrices.entry,
        planned_stop: plannedPrices.stop,
        planned_target: plannedPrices.target,
        planned_rr: plannedPrices.risk_reward,
        // Universal timeframe fields
        ...timeframeMetadata,
        trading_style: tradingContext.trading_style,
        analysis_specialization: mnqInsights ? 'mnq_specialist' : 'general'
      };

      await insertUniversalTradeRecord(db, tradeRecord);

      if (validationResults.errors.length > 0) {
        await insertRiskAlerts(db, tradeId, validationResults.errors);
      }

      await updatePatternCounts(db, analysis.pattern_type);

      const response = {
        trade_id: tradeId,
        timestamp: timestamp.toISOString(),
        trade_phase: 'pre_trade',
        analysis_type: 'universal_timeframe',
        timeframes_analyzed: timeframes,
        trading_context: tradingContext,
        completeness_score: analysis.completeness_score,
        hierarchy_analysis: {
          timeframe_hierarchy: hierarchyData.hierarchy,
          analysis_strategy: analysisStrategy.strategy,
          mnq_suitability: analysisStrategy.mnq_suitability
        },
        file_info: {
          timeframes: timeframes.reduce((acc, tf) => {
            const file = req.files[tf][0];
            const classification = hierarchyData.classified_timeframes.find(tfObj => tfObj.timeframe_label === tf);
            acc[tf] = {
              filename: file.filename,
              size: getFileStats(file.path)?.sizeReadable || 'Unknown',
              path: file.relativePath,
              category: classification?.classification.category,
              priority: classification?.classification.priority,
              is_primary: tf === tradingContext.primary_timeframe
            };
            return acc;
          }, {})
        },
        universal_timeframe_analysis: {
          timeframe_analysis: analysis.universal_timeframe_analysis,
          individual_analysis: analysis.individual_timeframe_analysis,
          specialized_insights: analysis.specialized_insights,
          cross_timeframe_confluence: analysis.universal_timeframe_analysis?.cross_timeframe_confluence || 'unknown',
          ...analysis,
          planned_prices: plannedPrices,
          compliance_check: {
            risk_amount: analysis.risk_amount,
            within_limits: analysis.within_limits,
            session_timing: analysis.session_timing,
            trade_frequency: `${tradeContext.tradesThisWeek + 1}_of_${process.env.MAX_TRADES_PER_WEEK || 3}_weekly`,
            validation_results: validationResults
          }
        },
        mnq_specialization: mnqInsights,
        execution_flow: {
          awaiting_execution: true,
          execution_upload_token: executionToken,
          execution_upload_url: `/api/trade/${tradeId}/execution`,
          instructions: "Upload execution screenshot after trade completion to analyze execution quality"
        },
        context: {
          week_number: weekNumber,
          year: year,
          trades_this_week: tradeContext.tradesThisWeek,
          weekly_progress: tradeContext.weeklyProgress
        }
      };

      res.json({
        success: true,
        message: 'Universal timeframe trading analysis completed successfully',
        data: response
      });

    } catch (error) {
      console.error('Universal timeframe upload analysis error:', error);

      await cleanupFailedUniversalUpload(req.files, tradeId);

      if (error.code === 'ANTHROPIC_API_ERROR') {
        return res.status(503).json({
          success: false,
          error: 'AI Analysis Failed',
          message: 'Unable to analyze universal timeframe screenshots. Please try again.',
          trade_id: tradeId
        });
      }

      throw error;
    } finally {
      db.close();
    }
  })
);

// Frontend-compatible upload endpoint
router.post('/upload-trade-frontend',
  universalTimeframeUpload.any(), // Accept any field names as timeframes
  validateFrontendTimeframeUpload,
  asyncHandler(async (req, res) => {
    const db = getDatabase();
    const tradeId = req.tradeId || uuidv4();
    const timestamp = new Date();
    const weekNumber = getWeekNumber(timestamp);
    const year = timestamp.getFullYear();

    try {
      const tradeContext = await getTradeContext(db, weekNumber, year);
      const timeframes = req.timeframesUploaded;
      const tradingContext = req.tradingContext;

      // Create timeframe objects for hierarchy analysis
      const timeframeObjects = timeframes.map(tf => ({
        timeframe_label: tf,
        is_primary: tf === tradingContext.primary_timeframe
      }));

      // Determine timeframe hierarchy and generate analysis strategy
      const hierarchyData = determineTimeframeHierarchy(timeframeObjects);
      const analysisStrategy = generateAnalysisStrategy(hierarchyData, tradingContext.trading_style);

      // Get MNQ specialization insights if applicable
      const mnqInsights = provideMNQInsights(hierarchyData, tradingContext);

      // Analyze with Claude using frontend-compatible approach
      let analysis;
      try {
        analysis = await claudeService.analyzeFrontendTimeframeScreenshots(
          req.files,
          tradingContext,
          hierarchyData
        );
      } catch (claudeError) {
        if (claudeError.message.includes('API key') || claudeError.message.includes('authentication_error')) {
          console.log('⚠️ Using fallback analysis due to API key issue');
          analysis = createFallbackFrontendAnalysis(timeframes, tradingContext, hierarchyData, req.body.notes || '');
        } else if (claudeError.code === 'ECONNABORTED') {
          return res.status(504).json({
            success: false,
            error: 'SERVER_TIMEOUT',
            message: 'Analysis is taking longer than expected. Please try again.',
            code: 504
          });
        } else {
          return res.status(422).json({
            success: false,
            error: 'ANALYSIS_FAILED',
            message: 'Unable to analyze screenshot. Please ensure chart is clearly visible.',
            code: 422
          });
        }
      }

      // Apply MNQ specialization adjustments to analysis
      if (mnqInsights) {
        analysis.confidence_score = Math.min(1.0, analysis.confidence_score * mnqInsights.confidence_multiplier);
        analysis.session_quality = mnqInsights.session_analysis.quality;
      }

      const validationResults = validateTradingRules(analysis);

      // Generate execution upload token
      const executionToken = `exec_${tradeId.substr(0, 8)}_${Date.now()}`;

      // Format timeframe metadata for database storage
      const timeframeMetadata = formatTimeframeMetadata(req.files, hierarchyData);

      // Build screenshot paths for frontend
      const screenshotPaths = {};
      timeframes.forEach(tf => {
        screenshotPaths[tf] = `/uploads/${req.files[tf][0].relativePath.replace(/\\/g, '/')}`;
      });

      // Store individual screenshot analysis
      for (const timeframe of timeframes) {
        const file = req.files[timeframe][0];
        const classification = hierarchyData.classified_timeframes.find(tf => tf.timeframe_label === timeframe);

        await insertUniversalScreenshotAnalysis(db, {
          trade_id: tradeId,
          screenshot_path: file.relativePath,
          timeframe_label: timeframe,
          timeframe_category: classification?.classification.category || 'unknown',
          timeframe_priority: classification?.classification.priority || 'context',
          is_primary: timeframe === tradingContext.primary_timeframe,
          individual_analysis: JSON.stringify({}), // Individual analysis not needed for frontend format
          pattern_identified: analysis.pattern_recognition?.primary_pattern || 'unknown',
          trend_direction: analysis.pattern_recognition?.market_structure?.toLowerCase() || 'neutral',
          key_levels: JSON.stringify([]),
          volume_analysis: analysis.pattern_recognition?.volume_profile || 'unknown',
          confluence_score: analysis.overall_setup_grade?.score || 5
        });
      }

      const tradeRecord = {
        id: tradeId,
        timestamp: timestamp.toISOString(),
        screenshot_path: req.files[tradingContext.primary_timeframe][0].relativePath, // Primary screenshot
        setup_quality: analysis.overall_setup_grade?.score || 5,
        risk_reward_ratio: parseFloat(analysis.risk_analysis?.risk_reward_ratio?.split(':')[0]) || 2,
        pattern_type: analysis.pattern_recognition?.primary_pattern || 'unknown',
        entry_quality: analysis.risk_analysis?.stop_placement?.toLowerCase() || 'good',
        stop_placement: analysis.risk_analysis?.stop_placement?.toLowerCase() || 'good',
        target_selection: analysis.risk_analysis?.position_size?.toLowerCase() || 'appropriate',
        ai_commentary: `${analysis.overall_setup_grade?.description || ''} ${(analysis.detailed_insights?.strengths || []).join('. ')}.`,
        risk_amount: analysis.risk_amount_dollars || 50,
        within_limits: (analysis.risk_amount_dollars || 50) <= 50,
        session_timing: analysis.session_quality || 'good',
        trade_frequency: `${tradeContext.tradesThisWeek + 1}_of_${process.env.MAX_TRADES_PER_WEEK || 3}_weekly`,
        learning_insights: (analysis.detailed_insights?.improvements || []).join('. '),
        recommendation: analysis.confidence_score > 0.7 ? 'EXECUTE' : analysis.confidence_score > 0.5 ? 'WAIT' : 'SKIP',
        confidence_score: analysis.confidence_score,
        specific_observations: analysis.recommended_actions || [],
        week_number: weekNumber,
        year: year,
        trade_phase: 'pre_trade',
        execution_upload_token: executionToken,
        planned_entry: null, // Will be extracted from detailed analysis
        planned_stop: null,
        planned_target: null,
        planned_rr: parseFloat(analysis.risk_analysis?.risk_reward_ratio?.split(':')[0]) || 2,
        // Universal timeframe fields
        ...timeframeMetadata,
        trading_style: tradingContext.trading_style,
        analysis_specialization: mnqInsights ? 'mnq_specialist' : 'general'
      };

      await insertUniversalTradeRecord(db, tradeRecord);

      if (validationResults.errors.length > 0) {
        await insertRiskAlerts(db, tradeId, validationResults.errors);
      }

      // Update pattern counts with the primary pattern
      await updatePatternCounts(db, analysis.pattern_recognition?.primary_pattern || 'unknown');

      // Build frontend-compatible response
      const response = {
        trade_id: tradeId,
        analysis: {
          overall_setup_grade: analysis.overall_setup_grade,
          pattern_recognition: analysis.pattern_recognition,
          risk_analysis: analysis.risk_analysis,
          detailed_insights: analysis.detailed_insights,
          recommended_actions: analysis.recommended_actions,
          screenshots: {
            primary_timeframe: tradingContext.primary_timeframe,
            available_timeframes: timeframes,
            screenshot_paths: screenshotPaths
          },
          confidence_score: analysis.confidence_score,
          analysis_confidence: analysis.analysis_confidence,
          session_quality: analysis.session_quality,
          risk_amount_dollars: analysis.risk_amount_dollars
        },
        trading_context: tradingContext,
        mnq_specialization: mnqInsights,
        execution_flow: {
          awaiting_execution: true,
          execution_upload_token: executionToken,
          execution_upload_url: `/api/trade/${tradeId}/execution`,
          instructions: "Upload execution screenshot after trade completion"
        },
        context: {
          week_number: weekNumber,
          year: year,
          trades_this_week: tradeContext.tradesThisWeek,
          weekly_progress: tradeContext.weeklyProgress
        }
      };

      res.json({
        success: true,
        message: 'Trading analysis completed successfully',
        data: response
      });

    } catch (error) {
      console.error('Frontend upload analysis error:', error);

      await cleanupFailedUniversalUpload(req.files, tradeId);

      if (error.code === 'ANTHROPIC_API_ERROR') {
        return res.status(422).json({
          success: false,
          error: 'ANALYSIS_FAILED',
          message: 'Unable to analyze screenshot. Please ensure chart is clearly visible.',
          code: 422
        });
      }

      throw error;
    } finally {
      db.close();
    }
  })
);

router.post('/trade/:tradeId/outcome',
  asyncHandler(async (req, res) => {
    const { tradeId } = req.params;
    const { executed, actual_pnl, outcome_notes } = req.body;

    if (!tradeId) {
      return res.status(400).json({
        success: false,
        error: 'Missing trade ID'
      });
    }

    const db = getDatabase();

    try {
      const trade = await getTradeById(db, tradeId);

      if (!trade) {
        return res.status(404).json({
          success: false,
          error: 'Trade not found'
        });
      }

      await updateTradeOutcome(db, tradeId, {
        executed: executed === true,
        actual_pnl: actual_pnl || null,
        actual_outcome: outcome_notes || null
      });

      if (executed && actual_pnl !== undefined) {
        await updatePatternSuccess(db, trade.pattern_type, actual_pnl > 0);
        await updateWeeklyProgress(db, actual_pnl, trade.week_number, trade.year);
      }

      res.json({
        success: true,
        message: 'Trade outcome updated successfully',
        trade_id: tradeId
      });

    } catch (error) {
      console.error('Trade outcome update error:', error);
      throw error;
    } finally {
      db.close();
    }
  })
);

router.post('/trade/:preTradeId/execution',
  upload.single('screenshot'),
  validateUploadedFile,
  asyncHandler(async (req, res) => {
    const { preTradeId } = req.params;
    const { execution_upload_token } = req.body;
    const db = getDatabase();
    const executionId = uuidv4();
    const timestamp = new Date();

    try {
      // Verify the pre-trade exists and token matches
      const preTrade = await getTradeById(db, preTradeId);

      if (!preTrade) {
        return res.status(404).json({
          success: false,
          error: 'Pre-trade analysis not found'
        });
      }

      if (preTrade.execution_upload_token !== execution_upload_token) {
        return res.status(401).json({
          success: false,
          error: 'Invalid execution upload token'
        });
      }

      if (preTrade.trade_phase !== 'pre_trade') {
        return res.status(400).json({
          success: false,
          error: 'Trade is not in pre-trade phase'
        });
      }

      // Get trader's execution patterns for context
      const executionPatterns = await getTraderExecutionPatterns(db);

      // Analyze execution screenshot with Claude
      let executionAnalysis;
      try {
        executionAnalysis = await claudeService.analyzeExecutionScreenshot(
          req.file.path,
          preTrade,
          executionPatterns
        );
      } catch (claudeError) {
        if (claudeError.message.includes('API key') || claudeError.message.includes('authentication_error')) {
          console.log('⚠️ Using fallback execution analysis due to API key issue');
          executionAnalysis = createFallbackExecutionAnalysis(req.body.notes || '', preTrade);
        } else {
          throw claudeError;
        }
      }

      // Calculate price variances
      const priceVariances = calculatePriceVariances(preTrade, executionAnalysis);

      // Create execution record
      const executionRecord = {
        id: executionId,
        timestamp: timestamp.toISOString(),
        screenshot_path: req.file.relativePath,
        trade_phase: 'execution',
        linked_execution_id: preTradeId,
        actual_entry: executionAnalysis.actual_prices.entry,
        actual_stop: executionAnalysis.actual_prices.stop,
        actual_target: executionAnalysis.actual_prices.target,
        actual_rr: executionAnalysis.actual_rr,
        execution_timing: executionAnalysis.execution_timing,
        execution_quality_grade: executionAnalysis.execution_quality_grade,
        price_variance_analysis: JSON.stringify(priceVariances),
        behavioral_observations: JSON.stringify(executionAnalysis.behavioral_observations),
        execution_coaching: executionAnalysis.coaching_insights.join('\n'),
        entry_variance: priceVariances.entry_variance,
        stop_variance: priceVariances.stop_variance,
        target_variance: priceVariances.target_variance,
        execution_screenshot_path: req.file.relativePath,
        week_number: preTrade.week_number,
        year: preTrade.year
      };

      await insertTradeRecord(db, executionRecord);

      // Update original pre-trade record
      await linkExecutionTrade(db, preTradeId, executionId);

      // Update execution patterns
      await updateExecutionPatterns(db, executionAnalysis, priceVariances);

      const response = {
        execution_id: executionId,
        linked_pre_trade_id: preTradeId,
        timestamp: timestamp.toISOString(),
        execution_analysis: {
          actual_prices: executionAnalysis.actual_prices,
          price_variance: priceVariances,
          execution_timing: executionAnalysis.execution_timing,
          execution_quality_grade: executionAnalysis.execution_quality_grade,
          behavioral_observations: executionAnalysis.behavioral_observations,
          coaching_insights: executionAnalysis.coaching_insights,
          execution_grade_breakdown: executionAnalysis.execution_grade_breakdown
        }
      };

      res.json({
        success: true,
        message: 'Execution analysis completed successfully',
        data: response
      });

    } catch (error) {
      console.error('Execution analysis error:', error);
      throw error;
    } finally {
      db.close();
    }
  })
);

router.get('/trade/:tradeId',
  asyncHandler(async (req, res) => {
    const { tradeId } = req.params;
    const db = getDatabase();

    try {
      const trade = await getTradeById(db, tradeId);

      if (!trade) {
        return res.status(404).json({
          success: false,
          error: 'Trade not found'
        });
      }

      res.json({
        success: true,
        data: trade
      });

    } catch (error) {
      console.error('Get trade error:', error);
      throw error;
    } finally {
      db.close();
    }
  })
);

router.get('/trade/:tradeId/complete',
  asyncHandler(async (req, res) => {
    const { tradeId } = req.params;
    const db = getDatabase();

    try {
      const trade = await getTradeById(db, tradeId);

      if (!trade) {
        return res.status(404).json({
          success: false,
          error: 'Trade not found'
        });
      }

      let linkedTrade = null;
      if (trade.linked_execution_id) {
        linkedTrade = await getTradeById(db, trade.linked_execution_id);
      }

      const completeAnalysis = await generateLearningSynthesis(db, trade, linkedTrade);

      res.json({
        success: true,
        data: {
          pre_trade_analysis: trade.trade_phase === 'pre_trade' ? trade : linkedTrade,
          execution_analysis: trade.trade_phase === 'execution' ? trade : linkedTrade,
          learning_synthesis: completeAnalysis
        }
      });

    } catch (error) {
      console.error('Complete trade analysis error:', error);
      throw error;
    } finally {
      db.close();
    }
  })
);

const extractPlannedPrices = (analysis) => {
  // Extract planned prices from Claude analysis response
  // This assumes Claude provides price targets in the analysis
  const commentary = analysis.ai_commentary || '';
  const specificObservations = analysis.specific_observations || [];

  // Try to parse prices from analysis text
  let entry = null, stop = null, target = null;

  // Look for price patterns in commentary and observations
  const allText = `${commentary} ${specificObservations.join(' ')}`;

  // Pattern for entry prices (e.g., "enter at 19698", "entry: 19698")
  const entryMatch = allText.match(/(?:enter\s*(?:at|:)?\s*|entry\s*:?\s*)(\d{4,5}(?:\.\d+)?)/i);
  if (entryMatch) entry = parseFloat(entryMatch[1]);

  // Pattern for stop prices
  const stopMatch = allText.match(/(?:stop\s*(?:at|:)?\s*|stop\s*loss\s*:?\s*)(\d{4,5}(?:\.\d+)?)/i);
  if (stopMatch) stop = parseFloat(stopMatch[1]);

  // Pattern for target prices
  const targetMatch = allText.match(/(?:target\s*(?:at|:)?\s*|profit\s*(?:at|:)?\s*)(\d{4,5}(?:\.\d+)?)/i);
  if (targetMatch) target = parseFloat(targetMatch[1]);

  // Fallback: use risk/reward ratio to calculate missing prices
  if (!entry && !stop && !target) {
    // If no specific prices found, generate reasonable estimates based on pattern
    // This is a fallback - ideally Claude should provide specific prices
    return {
      entry: null,
      stop: null,
      target: null,
      risk_reward: analysis.risk_reward_ratio || 2.0,
      note: 'Prices to be determined at execution'
    };
  }

  // Calculate missing prices if we have some reference points
  if (entry && stop && !target && analysis.risk_reward_ratio) {
    const risk = Math.abs(entry - stop);
    target = entry > stop ? entry + (risk * analysis.risk_reward_ratio) : entry - (risk * analysis.risk_reward_ratio);
  }

  return {
    entry: entry,
    stop: stop,
    target: target,
    risk_reward: analysis.risk_reward_ratio || 2.0
  };
};

const getTradeContext = (db, weekNumber, year) => {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT
        COUNT(*) as tradesThisWeek,
        COALESCE(SUM(actual_pnl), 0) as weeklyPnl,
        COALESCE(AVG(setup_quality), 0) as avgSetupQuality
      FROM trades
      WHERE week_number = ? AND year = ? AND executed = 1
    `, [weekNumber, year], (err, rows) => {
      if (err) {
        reject(err);
        return;
      }

      db.get(`
        SELECT account_balance
        FROM progress
        ORDER BY date DESC
        LIMIT 1
      `, (err, balanceRow) => {
        if (err) {
          reject(err);
          return;
        }

        resolve({
          tradesThisWeek: rows[0]?.tradesThisWeek || 0,
          weeklyPnl: rows[0]?.weeklyPnl || 0,
          avgSetupQuality: rows[0]?.avgSetupQuality || 0,
          currentBalance: balanceRow?.account_balance || 0,
          weeklyProgress: ((rows[0]?.weeklyPnl || 0) / 0.75) * 100
        });
      });
    });
  });
};

const insertTradeRecord = (db, record) => {
  return new Promise((resolve, reject) => {
    const sql = `
      INSERT INTO trades (
        id, timestamp, screenshot_path, setup_quality, risk_reward_ratio,
        pattern_type, entry_quality, stop_placement, target_selection,
        ai_commentary, risk_amount, within_limits, session_timing,
        trade_frequency, learning_insights, recommendation, week_number, year,
        trade_phase, execution_upload_token, planned_entry, planned_stop,
        planned_target, planned_rr
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    db.run(sql, [
      record.id, record.timestamp, record.screenshot_path, record.setup_quality,
      record.risk_reward_ratio, record.pattern_type, record.entry_quality,
      record.stop_placement, record.target_selection, record.ai_commentary,
      record.risk_amount, record.within_limits, record.session_timing,
      record.trade_frequency, record.learning_insights, record.recommendation,
      record.week_number, record.year, record.trade_phase, record.execution_upload_token,
      record.planned_entry, record.planned_stop, record.planned_target, record.planned_rr
    ], function(err) {
      if (err) reject(err);
      else resolve(this.lastID);
    });
  });
};

const insertRiskAlerts = (db, tradeId, errors) => {
  return new Promise((resolve, reject) => {
    const stmt = db.prepare(`
      INSERT INTO risk_alerts (trade_id, alert_type, message, severity)
      VALUES (?, ?, ?, ?)
    `);

    errors.forEach(error => {
      stmt.run(tradeId, error.rule, error.message, error.severity);
    });

    stmt.finalize((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
};

const updatePatternCounts = (db, patternType) => {
  return new Promise((resolve, reject) => {
    db.run(`
      INSERT OR IGNORE INTO patterns (pattern_name, total_count, last_seen)
      VALUES (?, 1, date('now'))
    `, [patternType], (err) => {
      if (err) {
        reject(err);
        return;
      }

      db.run(`
        UPDATE patterns
        SET total_count = total_count + 1,
            last_seen = date('now'),
            updated_at = datetime('now')
        WHERE pattern_name = ?
      `, [patternType], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  });
};

const getTradeById = (db, tradeId) => {
  return new Promise((resolve, reject) => {
    db.get(`
      SELECT * FROM trades WHERE id = ?
    `, [tradeId], (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

const updateTradeOutcome = (db, tradeId, outcome) => {
  return new Promise((resolve, reject) => {
    db.run(`
      UPDATE trades
      SET executed = ?, actual_pnl = ?, actual_outcome = ?
      WHERE id = ?
    `, [outcome.executed, outcome.actual_pnl, outcome.actual_outcome, tradeId], (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
};

const updatePatternSuccess = (db, patternType, wasSuccessful) => {
  return new Promise((resolve, reject) => {
    if (wasSuccessful) {
      db.run(`
        UPDATE patterns
        SET success_count = success_count + 1,
            updated_at = datetime('now')
        WHERE pattern_name = ?
      `, [patternType], (err) => {
        if (err) reject(err);
        else resolve();
      });
    } else {
      resolve();
    }
  });
};

const updateWeeklyProgress = (db, pnl, weekNumber, year) => {
  return new Promise((resolve, reject) => {
    db.run(`
      UPDATE progress
      SET week_pnl_percentage = week_pnl_percentage + ?,
          cumulative_pnl = cumulative_pnl + ?
      WHERE week_number = ? AND year = ?
    `, [pnl, pnl, weekNumber, year], (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
};

const cleanupFailedUpload = async (filePath, tradeId) => {
  try {
    const { cleanupFile } = require('../middleware/upload');
    cleanupFile(filePath);

    const db = getDatabase();
    db.run('DELETE FROM trades WHERE id = ?', [tradeId]);
    db.run('DELETE FROM risk_alerts WHERE trade_id = ?', [tradeId]);
    db.close();
  } catch (error) {
    console.error('Cleanup failed:', error);
  }
};

// Fallback analysis for testing when Claude API is not available
const createFallbackAnalysis = (notes = '') => {
  const plannedPrices = extractPlannedPricesFromNotes(notes);

  return {
    setup_quality: 7,
    risk_reward_ratio: plannedPrices.risk_reward || 2.0,
    pattern_type: 'opening_breakout',
    entry_quality: 'good',
    stop_placement: 'appropriate',
    target_selection: 'realistic',
    ai_commentary: `Fallback analysis for testing. Notes: ${notes}`,
    risk_amount: 45,
    within_limits: true,
    session_timing: 'optimal',
    trade_frequency: 'Within weekly limits',
    learning_insights: 'Fallback mode - Claude API unavailable',
    recommendation: 'EXECUTE',
    confidence_score: 0.8,
    specific_observations: [
      'Test mode analysis',
      'Claude API key not configured',
      'Using placeholder values for testing'
    ]
  };
};

const extractPlannedPricesFromNotes = (notes) => {
  const defaults = { entry: null, stop: null, target: null, risk_reward: 2.0 };

  if (!notes) return defaults;

  const entryMatch = notes.match(/entry.*?(\d+(?:\.\d+)?)/i);
  const stopMatch = notes.match(/stop.*?(\d+(?:\.\d+)?)/i);
  const targetMatch = notes.match(/target.*?(\d+(?:\.\d+)?)/i);

  const entry = entryMatch ? parseFloat(entryMatch[1]) : null;
  const stop = stopMatch ? parseFloat(stopMatch[1]) : null;
  const target = targetMatch ? parseFloat(targetMatch[1]) : null;

  let risk_reward = 2.0;
  if (entry && stop && target) {
    const risk = Math.abs(entry - stop);
    const reward = Math.abs(target - entry);
    risk_reward = risk > 0 ? reward / risk : 2.0;
  }

  return { entry, stop, target, risk_reward };
};

const createFallbackExecutionAnalysis = (notes = '', preTrade) => {
  const actualPrices = extractActualPricesFromNotes(notes);

  return {
    actual_prices: {
      entry: actualPrices.entry,
      stop: actualPrices.stop,
      target: actualPrices.target
    },
    actual_rr: actualPrices.risk_reward,
    execution_timing: 'optimal',
    execution_quality_grade: 'B+',
    behavioral_observations: [
      'Fallback execution analysis for testing',
      'Claude API unavailable',
      'Using extracted prices from notes'
    ],
    coaching_insights: [
      'Test mode execution analysis',
      'Manual review recommended when API is available',
      'Price extraction from notes successful'
    ],
    execution_grade_breakdown: {
      entry_timing: 'B+ - Acceptable execution timing',
      stop_management: 'B+ - Stop placement appropriate',
      target_selection: 'B+ - Target achieved within plan',
      overall_discipline: 'B+ - Good adherence to plan'
    },
    price_variance_analysis: {
      entry_variance_reasoning: 'Minor variance from planned entry acceptable',
      stop_variance_reasoning: 'Stop placement consistent with plan',
      target_variance_reasoning: 'Target achieved as planned',
      financial_impact: 'Minimal impact from execution variances'
    },
    learning_synthesis: {
      pattern_confirmation: 'Execution confirmed pre-trade analysis',
      skill_development_insights: 'Consistent execution discipline demonstrated',
      next_setup_preparation: 'Continue current approach'
    },
    advanced_coaching: {
      psychological_profile: 'Calm execution under test conditions',
      market_adaptation: 'Good adaptation to market conditions',
      professional_comparison: 'Execution meets professional standards'
    }
  };
};

const extractActualPricesFromNotes = (notes) => {
  const defaults = { entry: null, stop: null, target: null, risk_reward: 2.0 };

  if (!notes) return defaults;

  // Look for "actual" prices in notes
  const actualEntryMatch = notes.match(/actual\s+entry.*?(\d+(?:\.\d+)?)/i);
  const actualStopMatch = notes.match(/actual\s+stop.*?(\d+(?:\.\d+)?)/i);
  const actualTargetMatch = notes.match(/actual\s+target.*?(\d+(?:\.\d+)?)/i);

  const entry = actualEntryMatch ? parseFloat(actualEntryMatch[1]) : null;
  const stop = actualStopMatch ? parseFloat(actualStopMatch[1]) : null;
  const target = actualTargetMatch ? parseFloat(actualTargetMatch[1]) : null;

  let risk_reward = 2.0;
  if (entry && stop && target) {
    const risk = Math.abs(entry - stop);
    const reward = Math.abs(target - entry);
    risk_reward = risk > 0 ? reward / risk : 2.0;
  }

  return { entry, stop, target, risk_reward };
};

// New helper functions for execution analysis

const getTraderExecutionPatterns = (db) => {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT
        pattern_type,
        frequency_count,
        success_rate,
        average_impact,
        confidence_score,
        improvement_suggestion
      FROM execution_patterns
      WHERE trader_id = 'main_trader'
      ORDER BY coaching_priority ASC, frequency_count DESC
      LIMIT 10
    `, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
};

const calculatePriceVariances = (preTrade, executionAnalysis) => {
  const entryVariance = executionAnalysis.actual_prices.entry ?
    (executionAnalysis.actual_prices.entry - (preTrade.planned_entry || 0)) : 0;

  const stopVariance = executionAnalysis.actual_prices.stop ?
    (executionAnalysis.actual_prices.stop - (preTrade.planned_stop || 0)) : 0;

  const targetVariance = executionAnalysis.actual_prices.target ?
    (executionAnalysis.actual_prices.target - (preTrade.planned_target || 0)) : 0;

  return {
    entry_variance: Math.round(entryVariance * 100) / 100,
    stop_variance: Math.round(stopVariance * 100) / 100,
    target_variance: Math.round(targetVariance * 100) / 100,
    rr_impact: (executionAnalysis.actual_rr || 0) - (preTrade.planned_rr || 0)
  };
};

const linkExecutionTrade = (db, preTradeId, executionId) => {
  return new Promise((resolve, reject) => {
    db.run(`
      UPDATE trades
      SET linked_execution_id = ?, trade_phase = 'complete'
      WHERE id = ?
    `, [executionId, preTradeId], (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
};

const updateExecutionPatterns = (db, executionAnalysis, priceVariances) => {
  return new Promise((resolve, reject) => {
    // Identify patterns from execution analysis
    const patterns = identifyExecutionPatterns(executionAnalysis, priceVariances);

    let processedCount = 0;
    const totalPatterns = patterns.length;

    if (totalPatterns === 0) {
      resolve();
      return;
    }

    patterns.forEach(pattern => {
      // Check if pattern exists
      db.get(`
        SELECT id, frequency_count, success_rate, average_impact
        FROM execution_patterns
        WHERE pattern_type = ? AND trader_id = 'main_trader'
      `, [pattern.type], (err, existingPattern) => {
        if (err) {
          reject(err);
          return;
        }

        if (existingPattern) {
          // Update existing pattern
          const newFrequency = existingPattern.frequency_count + 1;
          const newImpact = ((existingPattern.average_impact * existingPattern.frequency_count) + pattern.impact) / newFrequency;

          db.run(`
            UPDATE execution_patterns
            SET frequency_count = ?,
                average_impact = ?,
                last_seen = date('now'),
                updated_at = datetime('now')
            WHERE id = ?
          `, [newFrequency, newImpact, existingPattern.id], (err) => {
            processedCount++;
            if (err) reject(err);
            else if (processedCount === totalPatterns) resolve();
          });
        } else {
          // Insert new pattern
          db.run(`
            INSERT INTO execution_patterns (
              pattern_type, frequency_count, average_impact,
              confidence_score, improvement_suggestion
            ) VALUES (?, 1, ?, 0.5, ?)
          `, [pattern.type, pattern.impact, pattern.suggestion], (err) => {
            processedCount++;
            if (err) reject(err);
            else if (processedCount === totalPatterns) resolve();
          });
        }
      });
    });
  });
};

const identifyExecutionPatterns = (executionAnalysis, priceVariances) => {
  const patterns = [];

  // Early entry pattern
  if (priceVariances.entry_variance > 2) {
    patterns.push({
      type: 'early_entry',
      impact: priceVariances.rr_impact,
      suggestion: 'Wait for pullback completion before entry trigger'
    });
  }

  // Late entry pattern
  if (priceVariances.entry_variance < -2) {
    patterns.push({
      type: 'late_entry',
      impact: priceVariances.rr_impact,
      suggestion: 'Set alerts to catch entry levels earlier'
    });
  }

  // Stop tightening pattern
  if (priceVariances.stop_variance > 2) {
    patterns.push({
      type: 'stop_tightening',
      impact: priceVariances.rr_impact,
      suggestion: 'Maintain planned stop levels for consistency'
    });
  }

  // Target extension pattern
  if (priceVariances.target_variance > 3) {
    patterns.push({
      type: 'target_extension',
      impact: priceVariances.rr_impact,
      suggestion: 'Target extensions show good momentum reading'
    });
  }

  return patterns;
};

const generateLearningSynthesis = (db, preTrade, executionTrade) => {
  return new Promise((resolve, reject) => {
    if (!preTrade || !executionTrade) {
      resolve({
        pattern_confirmation: 'Incomplete trade data',
        execution_lessons: [],
        next_similar_setup_guidance: 'Complete both pre-trade and execution analysis for synthesis'
      });
      return;
    }

    // Analyze pattern confirmation
    const patternConfirmed = executionTrade.actual_outcome === 'win' ? 'confirmed' : 'contradicted';

    // Extract execution lessons
    const lessons = JSON.parse(executionTrade.behavioral_observations || '[]');

    // Generate guidance for next similar setup
    const guidance = generateNextSetupGuidance(preTrade.pattern_type, executionTrade);

    resolve({
      pattern_confirmation: `${preTrade.pattern_type} pattern ${patternConfirmed} as expected`,
      execution_lessons: lessons,
      next_similar_setup_guidance: guidance,
      improvement_areas: identifyImprovementAreas(preTrade, executionTrade),
      strength_reinforcement: identifyStrengths(preTrade, executionTrade)
    });
  });
};

const generateNextSetupGuidance = (patternType, executionTrade) => {
  const grade = executionTrade.execution_quality_grade || 'C';

  if (grade.startsWith('A')) {
    return `Excellent execution on ${patternType}. Replicate this approach on similar setups.`;
  } else if (grade.startsWith('B')) {
    return `Good execution on ${patternType}. Focus on entry timing refinement.`;
  } else {
    return `${patternType} execution needs improvement. Review planned prices before entry.`;
  }
};

const identifyImprovementAreas = (preTrade, executionTrade) => {
  const areas = [];

  if (executionTrade.execution_timing === 'early') {
    areas.push('Entry timing discipline');
  }

  if (Math.abs(executionTrade.entry_variance || 0) > 3) {
    areas.push('Price level precision');
  }

  if (executionTrade.execution_quality_grade && executionTrade.execution_quality_grade.startsWith('C')) {
    areas.push('Overall execution consistency');
  }

  return areas;
};

const identifyStrengths = (preTrade, executionTrade) => {
  const strengths = [];

  if (executionTrade.execution_timing === 'optimal') {
    strengths.push('Excellent entry timing');
  }

  if (Math.abs(executionTrade.stop_variance || 0) < 2) {
    strengths.push('Disciplined stop management');
  }

  if (executionTrade.execution_quality_grade && executionTrade.execution_quality_grade.startsWith('A')) {
    strengths.push('Professional-grade execution');
  }

  return strengths;
};

// Multi-timeframe helper functions

const insertTimeframeAnalysis = (db, analysisData) => {
  return new Promise((resolve, reject) => {
    const sql = `
      INSERT INTO timeframe_analysis (
        trade_id, timeframe, screenshot_path, individual_analysis,
        pattern_identified, trend_direction, key_levels, volume_analysis, confluence_score
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    db.run(sql, [
      analysisData.trade_id,
      analysisData.timeframe,
      analysisData.screenshot_path,
      analysisData.individual_analysis,
      analysisData.pattern_identified,
      analysisData.trend_direction,
      analysisData.key_levels,
      analysisData.volume_analysis,
      analysisData.confluence_score
    ], function(err) {
      if (err) reject(err);
      else resolve(this.lastID);
    });
  });
};

const insertMultiTimefradeRecord = (db, record) => {
  return new Promise((resolve, reject) => {
    const sql = `
      INSERT INTO trades (
        id, timestamp, screenshot_path, setup_quality, risk_reward_ratio,
        pattern_type, entry_quality, stop_placement, target_selection,
        ai_commentary, risk_amount, within_limits, session_timing,
        trade_frequency, learning_insights, recommendation, week_number, year,
        trade_phase, execution_upload_token, planned_entry, planned_stop,
        planned_target, planned_rr, screenshot_1min, screenshot_5min,
        screenshot_15min, screenshot_daily, timeframes_uploaded,
        analysis_completeness_score, multi_timeframe_insights,
        trend_alignment_score, structure_confirmation
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    db.run(sql, [
      record.id, record.timestamp, record.screenshot_path, record.setup_quality,
      record.risk_reward_ratio, record.pattern_type, record.entry_quality,
      record.stop_placement, record.target_selection, record.ai_commentary,
      record.risk_amount, record.within_limits, record.session_timing,
      record.trade_frequency, record.learning_insights, record.recommendation,
      record.week_number, record.year, record.trade_phase, record.execution_upload_token,
      record.planned_entry, record.planned_stop, record.planned_target, record.planned_rr,
      record.screenshot_1min, record.screenshot_5min, record.screenshot_15min,
      record.screenshot_daily, record.timeframes_uploaded, record.analysis_completeness_score,
      record.multi_timeframe_insights, record.trend_alignment_score, record.structure_confirmation
    ], function(err) {
      if (err) reject(err);
      else resolve(this.lastID);
    });
  });
};

const cleanupFailedMultiTimeframeUpload = async (files, tradeId) => {
  try {
    cleanupMultiTimeframeFiles(files);

    const db = getDatabase();
    db.run('DELETE FROM trades WHERE id = ?', [tradeId]);
    db.run('DELETE FROM risk_alerts WHERE trade_id = ?', [tradeId]);
    db.run('DELETE FROM timeframe_analysis WHERE trade_id = ?', [tradeId]);
    db.close();
  } catch (error) {
    console.error('Multi-timeframe cleanup failed:', error);
  }
};

const createFallbackMultiTimeframeAnalysis = (timeframes = ['1min'], notes = '') => {
  const baseAnalysis = createFallbackAnalysis(notes);

  // Generate individual timeframe analysis
  const individualAnalysis = {};
  timeframes.forEach(tf => {
    individualAnalysis[tf] = {
      pattern_identified: 'opening_breakout',
      trend_direction: 'neutral',
      key_levels: ['19650', '19700', '19750'],
      volume_analysis: 'Average volume observed',
      entry_quality: 'fair',
      individual_setup_score: 6
    };
  });

  // Generate cross-timeframe analysis
  const crossTimeframeAnalysis = {
    trend_alignment: timeframes.length >= 3 ? 'moderate' : 'weak',
    structure_confluence: timeframes.length >= 2 ? 'medium' : 'low',
    entry_timing_quality: timeframes.length >= 3 ? 7 : 5,
    overall_setup_strength: Math.min(8, 4 + timeframes.length),
    risk_reward_context: 'Multi-timeframe analysis provides enhanced context',
    session_appropriateness: 'acceptable'
  };

  return {
    ...baseAnalysis,
    individual_timeframe_analysis: individualAnalysis,
    cross_timeframe_analysis: crossTimeframeAnalysis,
    timeframe_confluence_score: Math.min(0.8, 0.4 + (timeframes.length * 0.1)),
    analysis_confidence: Math.min(0.9, 0.5 + (timeframes.length * 0.1)),
    multi_timeframe_insights: `Analysis enhanced with ${timeframes.length} timeframes. Fallback mode active.`,
    trend_alignment_score: Math.min(0.8, 0.3 + (timeframes.length * 0.125)),
    structure_confirmation: `${timeframes.length} timeframes analyzed for structural confirmation`,
    completeness_score: Math.min(100, 60 + (timeframes.length * 10)),
    timeframes_analyzed: timeframes
  };
};

// Universal timeframe helper functions

const insertUniversalScreenshotAnalysis = (db, analysisData) => {
  return new Promise((resolve, reject) => {
    const sql = `
      INSERT INTO screenshot_analysis (
        trade_id, screenshot_path, timeframe_label, timeframe_category,
        timeframe_priority, is_primary, individual_analysis, pattern_identified,
        trend_direction, key_levels, volume_analysis, confluence_score
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    db.run(sql, [
      analysisData.trade_id,
      analysisData.screenshot_path,
      analysisData.timeframe_label,
      analysisData.timeframe_category,
      analysisData.timeframe_priority,
      analysisData.is_primary ? 1 : 0,
      analysisData.individual_analysis,
      analysisData.pattern_identified,
      analysisData.trend_direction,
      analysisData.key_levels,
      analysisData.volume_analysis,
      analysisData.confluence_score
    ], function(err) {
      if (err) reject(err);
      else resolve(this.lastID);
    });
  });
};

const insertUniversalTradeRecord = (db, record) => {
  return new Promise((resolve, reject) => {
    const sql = `
      INSERT INTO trades (
        id, timestamp, screenshot_path, setup_quality, risk_reward_ratio,
        pattern_type, entry_quality, stop_placement, target_selection,
        ai_commentary, risk_amount, within_limits, session_timing,
        trade_frequency, learning_insights, recommendation, week_number, year,
        trade_phase, execution_upload_token, planned_entry, planned_stop,
        planned_target, planned_rr, screenshots_metadata, timeframes_used,
        trading_style, analysis_specialization, analysis_completeness_score,
        multi_timeframe_insights, trend_alignment_score, structure_confirmation
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    db.run(sql, [
      record.id, record.timestamp, record.screenshot_path, record.setup_quality,
      record.risk_reward_ratio, record.pattern_type, record.entry_quality,
      record.stop_placement, record.target_selection, record.ai_commentary,
      record.risk_amount, record.within_limits, record.session_timing,
      record.trade_frequency, record.learning_insights, record.recommendation,
      record.week_number, record.year, record.trade_phase, record.execution_upload_token,
      record.planned_entry, record.planned_stop, record.planned_target, record.planned_rr,
      record.screenshots_metadata, record.timeframes_used, record.trading_style,
      record.analysis_specialization, record.analysis_completeness_score,
      record.multi_timeframe_insights, record.trend_alignment_score, record.structure_confirmation
    ], function(err) {
      if (err) reject(err);
      else resolve(this.lastID);
    });
  });
};

const cleanupFailedUniversalUpload = async (files, tradeId) => {
  try {
    cleanupMultiTimeframeFiles(files);

    const db = getDatabase();
    db.run('DELETE FROM trades WHERE id = ?', [tradeId]);
    db.run('DELETE FROM risk_alerts WHERE trade_id = ?', [tradeId]);
    db.run('DELETE FROM screenshot_analysis WHERE trade_id = ?', [tradeId]);
    db.close();
  } catch (error) {
    console.error('Universal upload cleanup failed:', error);
  }
};

const createFallbackUniversalAnalysis = (timeframes = ['1min'], tradingContext, hierarchyData, notes = '') => {
  const baseAnalysis = createFallbackAnalysis(notes);

  // Generate universal timeframe analysis
  const universalAnalysis = {
    timeframes_analyzed: timeframes,
    primary_timeframe: tradingContext.primary_timeframe || timeframes[0],
    timeframe_hierarchy: {
      entry_timeframe: hierarchyData.hierarchy.entry_timeframe?.timeframe_label || 'none',
      structure_timeframe: hierarchyData.hierarchy.structure_timeframe?.timeframe_label || 'none',
      trend_timeframe: hierarchyData.hierarchy.trend_timeframe?.timeframe_label || 'none'
    },
    cross_timeframe_confluence: timeframes.length >= 3 ? 'moderate' : 'weak'
  };

  // Generate individual timeframe analysis
  const individualAnalysis = {};
  timeframes.forEach(tf => {
    const classification = hierarchyData.classified_timeframes.find(tfObj => tfObj.timeframe_label === tf);
    individualAnalysis[tf] = {
      pattern_identified: 'opening_breakout',
      trend_direction: 'neutral',
      key_levels: ['19650', '19700', '19750'],
      volume_analysis: 'Average volume for fallback analysis',
      setup_quality: 6,
      timeframe_role: classification?.classification.priority || 'context'
    };
  });

  // Generate specialized insights based on trading context
  const specializedInsights = tradingContext.instrument === 'MNQ' && tradingContext.trading_style === 'mnq_scalping' ? {
    scalping_appropriateness: Math.min(8, 5 + timeframes.length),
    session_timing_quality: 'acceptable',
    micro_structure_analysis: 'Fallback MNQ analysis - standard microstructure assumed',
    volatility_assessment: 'moderate with fallback analysis',
    risk_reward_mnq_context: '1:2.0 appropriate for MNQ fallback context'
  } : {
    trading_appropriateness: Math.min(8, 5 + timeframes.length),
    session_quality: 'acceptable',
    market_structure: `Fallback analysis for ${tradingContext.instrument}`,
    volatility_context: `Standard volatility assessment for ${tradingContext.instrument}`
  };

  return {
    ...baseAnalysis,
    universal_timeframe_analysis: universalAnalysis,
    individual_timeframe_analysis: individualAnalysis,
    specialized_insights: specializedInsights,
    analysis_confidence: Math.min(0.8, 0.4 + (timeframes.length * 0.1)),
    completeness_score: Math.min(100, hierarchyData.analysis_completeness || 70),
    analysis_type: 'universal_timeframe',
    trading_context: tradingContext,
    hierarchy_data: hierarchyData
  };
};

// Frontend-compatible fallback analysis
const createFallbackFrontendAnalysis = (timeframes = ['1min'], tradingContext, hierarchyData, notes = '') => {
  return {
    overall_setup_grade: {
      grade: 'B',
      description: 'Fallback analysis - manual review recommended for optimal results',
      score: 7.0
    },
    pattern_recognition: {
      primary_pattern: 'Opening Range Breakout',
      confirmation_status: 'Pending',
      volume_profile: 'Average',
      market_structure: 'Neutral'
    },
    risk_analysis: {
      risk_reward_ratio: '2.5:1',
      stop_placement: 'Good',
      position_size: 'Conservative'
    },
    detailed_insights: {
      strengths: [
        'Multiple timeframes uploaded for analysis',
        `${timeframes.length} timeframes provide enhanced context`,
        'Systematic approach to trade analysis',
        'Risk management parameters within limits'
      ],
      improvements: [
        'Claude API unavailable - manual chart review recommended',
        'Verify pattern confirmation before execution'
      ]
    },
    recommended_actions: [
      `Monitor ${tradingContext.primary_timeframe} timeframe for clear breakout signal`,
      'Confirm volume expansion on breakout',
      'Set stop loss below recent support level'
    ],
    screenshots: {
      primary_timeframe: tradingContext.primary_timeframe || timeframes[0],
      available_timeframes: timeframes
    },
    confidence_score: 0.65,
    analysis_confidence: 'Moderate',
    session_quality: tradingContext.session_info?.includes('9:') || tradingContext.session_info?.includes('10:') ? 'good' : 'acceptable',
    risk_amount_dollars: 45
  };
};

// EXECUTION ANALYSIS SYSTEM (Phase 2)
// POST /api/trade/{preTradeId}/execution
router.post('/trade/:preTradeId/execution',
  upload.single('execution_screenshot'),
  validateUploadedFile,
  asyncHandler(async (req, res) => {
    const db = getDatabase();
    const { preTradeId } = req.params;
    const executionData = req.body.actual_execution ? JSON.parse(req.body.actual_execution) : req.body;

    try {
      // Verify pre-trade exists and get execution token
      const preTrade = await new Promise((resolve, reject) => {
        db.get(`
          SELECT id, execution_upload_token, planned_entry, planned_stop, planned_target, planned_rr,
                 pattern_type, trading_style, risk_amount, timestamp
          FROM trades
          WHERE id = ? AND trade_phase = 'pre_trade'
        `, [preTradeId], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });

      if (!preTrade) {
        return res.status(404).json({
          success: false,
          error: 'PRE_TRADE_NOT_FOUND',
          message: 'Original trade analysis not found or already has execution data',
          code: 404
        });
      }

      // Generate execution ID and prepare data
      const executionId = uuidv4();
      const timestamp = new Date();

      // Calculate variances
      const entryVariance = executionData.entry_price - (preTrade.planned_entry || executionData.entry_price);
      const stopVariance = executionData.stop_price - (preTrade.planned_stop || executionData.stop_price);
      const targetVariance = executionData.target_price - (preTrade.planned_target || executionData.target_price);

      // Calculate actual R:R
      const riskPoints = Math.abs(executionData.entry_price - executionData.stop_price);
      const rewardPoints = Math.abs(executionData.target_price - executionData.entry_price);
      const actualRR = riskPoints > 0 ? (rewardPoints / riskPoints) : (preTrade.planned_rr || 2);
      const rrImpact = actualRR - (preTrade.planned_rr || 2);

      // Determine P&L based on outcome
      let actualPnl = 0;
      if (executionData.trade_outcome === 'win') {
        actualPnl = rewardPoints * 2; // $2 per point for MNQ
      } else if (executionData.trade_outcome === 'loss') {
        actualPnl = -riskPoints * 2;
      } else if (executionData.trade_outcome === 'breakeven') {
        actualPnl = 0;
      }

      // Analyze execution with Claude API
      let executionAnalysis;
      try {
        executionAnalysis = await analyzeExecutionScreenshot(
          req.file,
          executionData,
          preTrade,
          {
            entry_variance: entryVariance,
            stop_variance: stopVariance,
            target_variance: targetVariance,
            rr_impact: rrImpact
          }
        );
      } catch (error) {
        console.error('Claude execution analysis failed:', error);
        executionAnalysis = generateFallbackExecutionAnalysis(executionData, preTrade);
      }

      // Create execution record
      const executionRecord = {
        id: executionId,
        timestamp: timestamp.toISOString(),
        screenshot_path: req.file.relativePath,
        linked_execution_id: preTradeId,
        trade_phase: 'execution',
        actual_entry: executionData.entry_price,
        actual_stop: executionData.stop_price,
        actual_target: executionData.target_price,
        actual_rr: actualRR,
        entry_variance: entryVariance,
        stop_variance: stopVariance,
        target_variance: targetVariance,
        execution_time: executionData.execution_time,
        trade_outcome: executionData.trade_outcome,
        actual_pnl: actualPnl,
        executed: true,
        execution_timing: executionAnalysis.execution_timing || 'good',
        execution_quality_grade: executionAnalysis.execution_grades?.overall_grade || 'B',
        behavioral_observations: JSON.stringify(executionAnalysis.behavioral_coaching?.execution_insights || []),
        execution_coaching: executionAnalysis.behavioral_coaching?.improvement_protocol || 'Continue systematic approach',
        pattern_type: preTrade.pattern_type,
        trading_style: preTrade.trading_style,
        risk_amount: preTrade.risk_amount,
        week_number: getWeekNumber(timestamp),
        year: timestamp.getFullYear()
      };

      // Insert execution record
      await insertUniversalTradeRecord(db, executionRecord);

      // Update original pre-trade record with execution link
      await new Promise((resolve, reject) => {
        db.run(`
          UPDATE trades
          SET linked_execution_id = ?, actual_pnl = ?, executed = TRUE, actual_outcome = ?
          WHERE id = ?
        `, [executionId, actualPnl, executionData.trade_outcome, preTradeId], (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      // Build response
      const response = {
        execution_id: executionId,
        execution_analysis: {
          planned_vs_actual: {
            entry_variance: `${entryVariance > 0 ? '+' : ''}${entryVariance.toFixed(1)} pts`,
            stop_variance: `${stopVariance > 0 ? '+' : ''}${stopVariance.toFixed(1)} pts`,
            target_variance: `${targetVariance > 0 ? '+' : ''}${targetVariance.toFixed(1)} pts`,
            rr_impact: `${rrImpact > 0 ? '+' : ''}${rrImpact.toFixed(1)}`
          },
          execution_grades: executionAnalysis.execution_grades || {
            entry_timing: gradeFromVariance(entryVariance),
            stop_management: gradeFromVariance(stopVariance),
            target_selection: gradeFromVariance(targetVariance),
            overall_grade: executionAnalysis.execution_grades?.overall_grade || 'B'
          },
          behavioral_coaching: executionAnalysis.behavioral_coaching || {
            execution_insights: "Execution analysis completed successfully.",
            strengths_reinforcement: "Disciplined execution approach maintained.",
            improvement_protocol: "Continue systematic trade management.",
            next_similar_setup: "Apply same execution principles to similar setups."
          },
          detailed_learning_analysis: executionAnalysis.detailed_learning_analysis || {
            psychological_profile: "Consistent execution psychology development.",
            skill_trajectory: "Progressive improvement in trade management.",
            long_term_impact: "Building systematic execution habits."
          }
        }
      };

      res.json({
        success: true,
        data: response
      });

    } catch (error) {
      console.error('Execution analysis error:', error);
      throw error;
    } finally {
      db.close();
    }
  })
);

// Helper function to analyze execution screenshot
const analyzeExecutionScreenshot = async (screenshot, executionData, preTrade, variances) => {
  const claudeAnalysis = require('../services/claudeAnalysis');

  const executionPrompt = `
    EXECUTION ANALYSIS REQUEST

    Pre-trade Plan:
    - Entry: ${preTrade.planned_entry || 'N/A'}
    - Stop: ${preTrade.planned_stop || 'N/A'}
    - Target: ${preTrade.planned_target || 'N/A'}
    - R:R: ${preTrade.planned_rr || 'N/A'}:1

    Actual Execution:
    - Entry: ${executionData.entry_price}
    - Stop: ${executionData.stop_price}
    - Target: ${executionData.target_price}
    - Outcome: ${executionData.trade_outcome}
    - Time: ${executionData.execution_time}

    Price Variances:
    - Entry variance: ${variances.entry_variance} points
    - Stop variance: ${variances.stop_variance} points
    - Target variance: ${variances.target_variance} points
    - R:R impact: ${variances.rr_impact}

    Analyze the execution screenshot and provide:
    1. Execution timing grade (A+ to F)
    2. Entry, stop, and target management grades
    3. Behavioral insights (150+ words)
    4. Specific improvement protocols
    5. Psychological profile assessment

    Focus on execution discipline, timing, and adherence to plan.
  `;

  return await claudeAnalysis.analyzeSingleScreenshot(screenshot.path, executionPrompt);
};

// Fallback execution analysis when Claude API fails
const generateFallbackExecutionAnalysis = (executionData, preTrade) => {
  const entryGrade = Math.abs(executionData.entry_price - (preTrade.planned_entry || executionData.entry_price)) < 2 ? 'A' : 'B';
  const stopGrade = Math.abs(executionData.stop_price - (preTrade.planned_stop || executionData.stop_price)) < 3 ? 'A' : 'B';
  const targetGrade = 'B'; // Default grade

  return {
    execution_timing: 'good',
    execution_grades: {
      entry_timing: entryGrade,
      stop_management: stopGrade,
      target_selection: targetGrade,
      overall_grade: calculateOverallGrade([entryGrade, stopGrade, targetGrade])
    },
    behavioral_coaching: {
      execution_insights: `Your execution shows ${executionData.trade_outcome === 'win' ? 'successful' : 'disciplined'} trade management. ${executionData.trade_outcome === 'win' ? 'The winning outcome validates your setup analysis.' : 'Even with the loss, maintaining discipline is crucial for long-term success.'} Continue following your systematic approach to trade execution.`,
      strengths_reinforcement: "You maintained discipline in following through with the trade execution as planned.",
      improvement_protocol: "Continue systematic execution approach. Monitor for any emotional deviations from the plan.",
      next_similar_setup: `On next ${preTrade.pattern_type} setup: maintain the same disciplined execution approach.`
    },
    detailed_learning_analysis: {
      psychological_profile: "Your execution demonstrates developing consistency in trade management and emotional control.",
      skill_trajectory: "Building systematic execution habits through disciplined trade management.",
      long_term_impact: "Consistent execution discipline is key to long-term trading success."
    }
  };
};

// Helper to grade execution based on variance
const gradeFromVariance = (variance) => {
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

// Calculate overall grade from individual grades
const calculateOverallGrade = (grades) => {
  const gradeValues = { 'A+': 4.3, 'A': 4.0, 'A-': 3.7, 'B+': 3.3, 'B': 3.0, 'B-': 2.7, 'C+': 2.3, 'C': 2.0 };
  const avgValue = grades.reduce((sum, grade) => sum + (gradeValues[grade] || 2.0), 0) / grades.length;

  if (avgValue >= 4.2) return 'A+';
  if (avgValue >= 3.9) return 'A';
  if (avgValue >= 3.5) return 'A-';
  if (avgValue >= 3.2) return 'B+';
  if (avgValue >= 2.9) return 'B';
  if (avgValue >= 2.5) return 'B-';
  if (avgValue >= 2.2) return 'C+';
  return 'C';
};

module.exports = router;
