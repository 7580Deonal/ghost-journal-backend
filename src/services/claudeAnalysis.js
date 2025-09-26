const axios = require('axios');
const fs = require('fs');
const path = require('path');

class ClaudeAnalysisService {
  constructor() {
    this.apiKey = process.env.ANTHROPIC_API_KEY;
    this.apiUrl = 'https://api.anthropic.com/v1/messages';

    if (!this.apiKey) {
      console.error('⚠️ ANTHROPIC_API_KEY not found in environment variables');
    }
  }

  async analyzeTradeScreenshot(filePath, tradeContext = {}) {
    if (!this.apiKey) {
      throw new Error('Anthropic API key not configured');
    }

    try {
      const imageData = this.encodeImageToBase64(filePath);
      const fileExtension = path.extname(filePath).toLowerCase();
      const mediaType = this.getMediaType(fileExtension);

      const prompt = this.buildAnalysisPrompt(tradeContext);

      const response = await axios.post(
        this.apiUrl,
        {
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 2000,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: prompt
                },
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: mediaType,
                    data: imageData
                  }
                }
              ]
            }
          ]
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.apiKey,
            'anthropic-version': '2023-06-01'
          },
          timeout: 30000
        }
      );

      const analysisText = response.data.content[0].text;
      return this.parseAnalysisResponse(analysisText);

    } catch (error) {
      console.error('Claude API Error:', error.response?.data || error.message);

      if (error.response?.status === 401) {
        throw new Error('Invalid Anthropic API key');
      } else if (error.response?.status === 429) {
        throw new Error('API rate limit exceeded. Please try again later.');
      } else if (error.code === 'ECONNABORTED') {
        throw new Error('Analysis request timed out');
      } else {
        const apiError = new Error('Failed to analyze trading screenshot');
        apiError.code = 'ANTHROPIC_API_ERROR';
        throw apiError;
      }
    }
  }

  buildAnalysisPrompt(context) {
    const currentWeek = this.getCurrentWeekNumber();
    const currentYear = new Date().getFullYear();

    return `You are analyzing a trading screenshot for a professional MNQ scalper with the following context:

TRADER PROFILE:
- Instrument: MNQ (Micro NQ Futures)
- Style: Opening session scalper (9:30-10:15 AM EST)
- Target: 0.75% weekly returns through 2-3 trades
- Risk Rule: Maximum $50 per trade (1% account risk)
- 5-Year Goal: Building $500 → $951,000

CURRENT TRADING STATUS:
- Week ${currentWeek}, ${currentYear}
- Account Phase: ${context.currentBalance > 50000 ? 'Phase 2 (Growth)' : 'Phase 1 (Building)'}
- Current Balance: $${context.currentBalance || 'Unknown'}
- This Week's Trades: ${context.tradesThisWeek || 0}/3
- This Week's P&L: ${context.weeklyPnl || 0}%

TRADING HISTORY CONTEXT:
${context.recentTrades ? `Recent similar patterns: ${context.recentTrades}` : 'No recent pattern history available'}

Please analyze this screenshot and provide a JSON-structured response with the following fields:

{
  "setup_quality": (1-10 rating),
  "risk_reward_ratio": (calculated R:R ratio),
  "pattern_type": "(opening_breakout|volume_spike|pullback_entry|range_break|momentum_continuation|reversal_pattern|gap_fill|premarket_setup)",
  "entry_quality": "(excellent|good|fair|poor)",
  "stop_placement": "(appropriate|too_tight|too_wide|unclear)",
  "target_selection": "(realistic|aggressive|conservative|unclear)",
  "ai_commentary": "Detailed analysis of this specific setup in context of your MNQ scalping approach",
  "risk_amount": (estimated dollar risk amount),
  "within_limits": (true/false based on $50 max rule),
  "session_timing": "(optimal|acceptable|poor)",
  "trade_frequency": "Assessment of whether this trade fits weekly frequency goals",
  "learning_insights": "Reference to similar past trades and pattern evolution",
  "recommendation": "(EXECUTE|WAIT|SKIP)",
  "confidence_score": (0-1 confidence in analysis),
  "specific_observations": [
    "Key technical observations",
    "Risk management notes",
    "Entry/exit timing insights"
  ]
}

Focus specifically on:
1. MNQ scalping dynamics and microstructure
2. Opening session volatility patterns (9:30-10:15 AM)
3. Risk management alignment with $50 max rule
4. Setup quality for 0.25% scalp targets
5. Pattern recognition for systematic improvement

Provide only the JSON response without additional text.`;
  }

  parseAnalysisResponse(analysisText) {
    try {
      const jsonMatch = analysisText.match(/\{[\s\S]*\}/);

      if (!jsonMatch) {
        throw new Error('No valid JSON found in analysis response');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      return {
        setup_quality: Math.max(1, Math.min(10, parsed.setup_quality || 5)),
        risk_reward_ratio: Math.max(0, parsed.risk_reward_ratio || 1),
        pattern_type: this.validatePattern(parsed.pattern_type) || 'unknown',
        entry_quality: this.validateQuality(parsed.entry_quality) || 'fair',
        stop_placement: this.validatePlacement(parsed.stop_placement) || 'unclear',
        target_selection: this.validateSelection(parsed.target_selection) || 'unclear',
        ai_commentary: parsed.ai_commentary || 'Analysis completed',
        risk_amount: Math.max(0, parsed.risk_amount || 0),
        within_limits: parsed.within_limits === true,
        session_timing: this.validateTiming(parsed.session_timing) || 'acceptable',
        trade_frequency: parsed.trade_frequency || 'Unknown frequency assessment',
        learning_insights: parsed.learning_insights || 'No historical patterns referenced',
        recommendation: this.validateRecommendation(parsed.recommendation) || 'WAIT',
        confidence_score: Math.max(0, Math.min(1, parsed.confidence_score || 0.5)),
        specific_observations: Array.isArray(parsed.specific_observations)
          ? parsed.specific_observations
          : ['Analysis completed successfully']
      };
    } catch (error) {
      console.error('Failed to parse Claude response:', error);

      return {
        setup_quality: 5,
        risk_reward_ratio: 1,
        pattern_type: 'unknown',
        entry_quality: 'fair',
        stop_placement: 'unclear',
        target_selection: 'unclear',
        ai_commentary: 'Analysis parsing failed. Manual review recommended.',
        risk_amount: 0,
        within_limits: false,
        session_timing: 'unclear',
        trade_frequency: 'Unable to assess',
        learning_insights: 'Analysis incomplete',
        recommendation: 'SKIP',
        confidence_score: 0.1,
        specific_observations: ['Parsing error occurred']
      };
    }
  }

  validatePattern(pattern) {
    const validPatterns = [
      'opening_breakout', 'volume_spike', 'pullback_entry', 'range_break',
      'momentum_continuation', 'reversal_pattern', 'gap_fill', 'premarket_setup'
    ];
    return validPatterns.includes(pattern) ? pattern : null;
  }

  validateQuality(quality) {
    const validQualities = ['excellent', 'good', 'fair', 'poor'];
    return validQualities.includes(quality) ? quality : null;
  }

  validatePlacement(placement) {
    const validPlacements = ['appropriate', 'too_tight', 'too_wide', 'unclear'];
    return validPlacements.includes(placement) ? placement : null;
  }

  validateSelection(selection) {
    const validSelections = ['realistic', 'aggressive', 'conservative', 'unclear'];
    return validSelections.includes(selection) ? selection : null;
  }

  validateTiming(timing) {
    const validTimings = ['optimal', 'acceptable', 'poor'];
    return validTimings.includes(timing) ? timing : null;
  }

  validateRecommendation(recommendation) {
    const validRecommendations = ['EXECUTE', 'WAIT', 'SKIP'];
    return validRecommendations.includes(recommendation) ? recommendation : null;
  }

  encodeImageToBase64(filePath) {
    try {
      const imageBuffer = fs.readFileSync(filePath);
      return imageBuffer.toString('base64');
    } catch (error) {
      throw new Error(`Failed to read image file: ${error.message}`);
    }
  }

  getMediaType(extension) {
    const mediaTypes = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.pdf': 'application/pdf'
    };
    return mediaTypes[extension] || 'image/png';
  }

  getCurrentWeekNumber() {
    const date = new Date();
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  }

  async analyzeExecutionScreenshot(filePath, preTrade, executionPatterns = []) {
    if (!this.apiKey) {
      throw new Error('Anthropic API key not configured');
    }

    try {
      const imageData = this.encodeImageToBase64(filePath);
      const fileExtension = path.extname(filePath).toLowerCase();
      const mediaType = this.getMediaType(fileExtension);

      const prompt = this.buildExecutionAnalysisPrompt(preTrade, executionPatterns);

      const response = await axios.post(
        this.apiUrl,
        {
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 3000, // Increased for detailed execution analysis
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: prompt
                },
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: mediaType,
                    data: imageData
                  }
                }
              ]
            }
          ]
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.apiKey,
            'anthropic-version': '2023-06-01'
          },
          timeout: 45000 // Extended timeout for detailed analysis
        }
      );

      const analysisText = response.data.content[0].text;
      return this.parseExecutionResponse(analysisText);

    } catch (error) {
      console.error('Claude Execution Analysis Error:', error.response?.data || error.message);

      if (error.response?.status === 401) {
        throw new Error('Invalid Anthropic API key');
      } else if (error.response?.status === 429) {
        throw new Error('API rate limit exceeded. Please try again later.');
      } else if (error.code === 'ECONNABORTED') {
        throw new Error('Execution analysis request timed out');
      } else {
        const apiError = new Error('Failed to analyze execution screenshot');
        apiError.code = 'ANTHROPIC_API_ERROR';
        throw apiError;
      }
    }
  }

  buildExecutionAnalysisPrompt(preTrade, executionPatterns) {
    const patternsContext = executionPatterns.length > 0
      ? executionPatterns.map(p => `${p.pattern_type}: ${p.frequency_count} occurrences, ${p.average_impact}% avg impact`).join('\n')
      : 'No historical execution patterns available yet.';

    return `You are analyzing EXECUTION QUALITY for an MNQ scalper comparing planned vs actual trade execution. This is a DETAILED EDUCATIONAL ANALYSIS, not brief observations. Provide comprehensive, masterclass-level coaching.

TRADER CONTEXT:
- 5-year wealth building: $500 → $951,000 goal
- MNQ scalping style: 9:30-10:15 AM sessions
- Target: 0.75% weekly returns, $50 max risk per trade
- Risk per trade: $50 maximum (1% account risk rule)

PRE-TRADE PLAN:
Pattern: ${preTrade.pattern_type || 'Unknown'}
Setup Quality: ${preTrade.setup_quality || 'Unknown'}/10
Planned Entry: ${preTrade.planned_entry || 'Not specified'}
Planned Stop: ${preTrade.planned_stop || 'Not specified'}
Planned Target: ${preTrade.planned_target || 'Not specified'}
Planned R:R: ${preTrade.planned_rr || preTrade.risk_reward_ratio || 'Unknown'}
AI Recommendation: ${preTrade.recommendation || 'Unknown'}
Risk Amount: $${preTrade.risk_amount || 'Unknown'}

HISTORICAL EXECUTION PATTERNS:
${patternsContext}

EXECUTION ANALYSIS REQUIRED - PROVIDE DETAILED, EDUCATIONAL RESPONSES:

Analyze this execution screenshot and determine the actual entry, stop, and target prices, then provide comprehensive analysis in JSON format:

{
  "actual_prices": {
    "entry": [actual entry price from screenshot],
    "stop": [actual stop price from screenshot],
    "target": [actual target price from screenshot]
  },
  "actual_rr": [calculated actual risk/reward ratio],
  "execution_timing": "[early/optimal/late]",
  "execution_quality_grade": "[A+, A, A-, B+, B, B-, C+, C, C-, D, F]",
  "behavioral_observations": [
    "Specific behavioral patterns identified",
    "Psychological triggers observed",
    "Discipline strengths and weaknesses"
  ],
  "coaching_insights": [
    "Detailed personalized coaching points",
    "Specific improvement strategies",
    "Reinforcement of good behaviors"
  ],
  "execution_grade_breakdown": {
    "entry_timing": "[grade with reasoning]",
    "stop_management": "[grade with reasoning]",
    "target_selection": "[grade with reasoning]",
    "overall_discipline": "[grade with reasoning]"
  },
  "price_variance_analysis": {
    "entry_variance_reasoning": "Why entry price differed from plan",
    "stop_variance_reasoning": "Why stop differed from plan",
    "target_variance_reasoning": "Why target differed from plan",
    "financial_impact": "Dollar impact of variances"
  },
  "learning_synthesis": {
    "pattern_confirmation": "How execution confirmed or contradicted setup analysis",
    "skill_development_insights": "Areas of growth and regression",
    "next_setup_preparation": "Specific guidance for similar future trades"
  },
  "advanced_coaching": {
    "psychological_profile": "Trading psychology insights from this execution",
    "market_adaptation": "How well trader adapted to real-time conditions",
    "professional_comparison": "How execution compares to elite MNQ scalpers"
  }
}

COACHING TONE: Write as an elite trading mentor providing comprehensive, personalized education. Every insight should be specific to this trader's MNQ scalping journey and 5-year wealth building plan. Focus on execution improvement and trading psychology development.

Provide only the JSON response without additional text.`;
  }

  parseExecutionResponse(analysisText) {
    try {
      const jsonMatch = analysisText.match(/\{[\s\S]*\}/);

      if (!jsonMatch) {
        throw new Error('No valid JSON found in execution analysis response');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      return {
        actual_prices: {
          entry: parsed.actual_prices?.entry || null,
          stop: parsed.actual_prices?.stop || null,
          target: parsed.actual_prices?.target || null
        },
        actual_rr: parsed.actual_rr || 0,
        execution_timing: this.validateExecutionTiming(parsed.execution_timing) || 'unknown',
        execution_quality_grade: parsed.execution_quality_grade || 'C',
        behavioral_observations: Array.isArray(parsed.behavioral_observations)
          ? parsed.behavioral_observations
          : ['Execution analysis completed'],
        coaching_insights: Array.isArray(parsed.coaching_insights)
          ? parsed.coaching_insights
          : ['Analysis completed successfully'],
        execution_grade_breakdown: parsed.execution_grade_breakdown || {
          entry_timing: 'C',
          stop_management: 'C',
          target_selection: 'C',
          overall_discipline: 'C'
        },
        price_variance_analysis: parsed.price_variance_analysis || 'Analysis completed',
        learning_synthesis: parsed.learning_synthesis || {},
        advanced_coaching: parsed.advanced_coaching || {}
      };
    } catch (error) {
      console.error('Failed to parse execution analysis response:', error);

      return {
        actual_prices: { entry: null, stop: null, target: null },
        actual_rr: 0,
        execution_timing: 'unknown',
        execution_quality_grade: 'C',
        behavioral_observations: ['Execution analysis parsing failed'],
        coaching_insights: ['Manual review recommended'],
        execution_grade_breakdown: {
          entry_timing: 'C',
          stop_management: 'C',
          target_selection: 'C',
          overall_discipline: 'C'
        },
        price_variance_analysis: 'Analysis incomplete',
        learning_synthesis: {},
        advanced_coaching: {}
      };
    }
  }

  validateExecutionTiming(timing) {
    const validTimings = ['early', 'optimal', 'late', 'unknown'];
    return validTimings.includes(timing) ? timing : null;
  }

  // Multi-timeframe analysis method
  async analyzeMultiTimeframeScreenshots(timeframeFiles, tradeContext = {}) {
    if (!this.apiKey) {
      throw new Error('Anthropic API key not configured');
    }

    try {
      const timeframes = Object.keys(timeframeFiles).sort();
      const imageContents = [];
      const fileAnalysis = {};

      // Process each timeframe image
      for (const timeframe of timeframes) {
        const file = timeframeFiles[timeframe][0]; // Get first file from array
        const imageData = this.encodeImageToBase64(file.path);
        const mediaType = this.getMediaType(path.extname(file.path).toLowerCase());

        fileAnalysis[timeframe] = {
          path: file.relativePath,
          filename: file.filename
        };

        imageContents.push({
          type: 'text',
          text: `\n=== ${timeframe.toUpperCase()} CHART ===`
        });

        imageContents.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: mediaType,
            data: imageData
          }
        });
      }

      const prompt = this.buildMultiTimeframeAnalysisPrompt(timeframes, tradeContext);

      const response = await axios.post(
        this.apiUrl,
        {
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 4000, // Increased for comprehensive multi-timeframe analysis
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: prompt
                },
                ...imageContents
              ]
            }
          ]
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.apiKey,
            'anthropic-version': '2023-06-01'
          },
          timeout: 60000 // Extended timeout for multi-timeframe analysis
        }
      );

      const analysisText = response.data.content[0].text;
      const parsedAnalysis = this.parseMultiTimeframeResponse(analysisText);

      return {
        ...parsedAnalysis,
        file_analysis: fileAnalysis,
        timeframes_analyzed: timeframes,
        completeness_score: this.calculateCompletenessScore(timeframes)
      };

    } catch (error) {
      console.error('Claude Multi-Timeframe Analysis Error:', error.response?.data || error.message);

      if (error.response?.status === 401) {
        throw new Error('Invalid Anthropic API key');
      } else if (error.response?.status === 429) {
        throw new Error('API rate limit exceeded. Please try again later.');
      } else if (error.code === 'ECONNABORTED') {
        throw new Error('Multi-timeframe analysis request timed out');
      } else {
        const apiError = new Error('Failed to analyze multi-timeframe screenshots');
        apiError.code = 'ANTHROPIC_API_ERROR';
        throw apiError;
      }
    }
  }

  buildMultiTimeframeAnalysisPrompt(timeframes, context) {
    const currentWeek = this.getCurrentWeekNumber();
    const currentYear = new Date().getFullYear();
    const timeframesList = timeframes.join(', ');

    return `You are analyzing multiple timeframe screenshots for MNQ futures scalping. Provide comprehensive multi-timeframe analysis.

TRADER CONTEXT:
- MNQ scalping specialist: 9:30-10:15 AM sessions
- 5-year wealth building plan: systematic skill development
- Risk management: $50 maximum per trade
- Target: 0.75% weekly returns through disciplined execution

CURRENT STATUS:
- Week ${currentWeek}, ${currentYear}
- Account Balance: $${context.currentBalance || 'Unknown'}
- This Week's Trades: ${context.tradesThisWeek || 0}/3
- Weekly P&L: ${context.weeklyPnl || 0}%

UPLOADED TIMEFRAMES: ${timeframesList}

MULTI-TIMEFRAME ANALYSIS REQUIRED:

Analyze each timeframe individually, then provide cross-timeframe confluence analysis. Return JSON with this structure:

{
  "individual_timeframe_analysis": {
    ${timeframes.map(tf => `"${tf}": {
      "pattern_identified": "specific pattern on this timeframe",
      "trend_direction": "bullish|bearish|neutral",
      "key_levels": ["support/resistance levels"],
      "volume_analysis": "volume characteristics on this timeframe",
      "entry_quality": "excellent|good|fair|poor",
      "individual_setup_score": 1-10
    }`).join(',\n    ')}
  },
  "cross_timeframe_analysis": {
    "trend_alignment": "strong|moderate|weak|conflicting",
    "structure_confluence": "high|medium|low",
    "entry_timing_quality": 1-10,
    "overall_setup_strength": 1-10,
    "risk_reward_context": "multi-timeframe R:R assessment",
    "session_appropriateness": "optimal|acceptable|poor"
  },
  "enhanced_analysis": {
    "setup_quality": 1-10,
    "risk_reward_ratio": "calculated R:R",
    "pattern_type": "dominant pattern from confluence",
    "entry_quality": "excellent|good|fair|poor",
    "stop_placement": "appropriate|too_tight|too_wide",
    "target_selection": "realistic|aggressive|conservative",
    "ai_commentary": "Comprehensive multi-timeframe analysis",
    "risk_amount": "estimated dollar risk",
    "within_limits": true|false,
    "session_timing": "optimal|acceptable|poor",
    "trade_frequency": "frequency assessment",
    "learning_insights": "cross-timeframe pattern insights",
    "recommendation": "EXECUTE|WAIT|SKIP",
    "confidence_score": 0-1,
    "specific_observations": ["key multi-timeframe observations"]
  },
  "timeframe_confluence_score": 0-1,
  "analysis_confidence": 0-1,
  "multi_timeframe_insights": "specific insights gained from multiple timeframes",
  "trend_alignment_score": 0-1,
  "structure_confirmation": "how higher timeframes confirm/contradict lower timeframe setup"
}

ANALYSIS DEPTH BY TIMEFRAME COMBINATION:
- 1-timeframe: Basic pattern recognition
- 2-timeframes: Enhanced setup validation
- 3+ timeframes: Professional-grade confluence analysis
- 4 timeframes: Complete market context analysis

Focus on:
1. Individual timeframe analysis for each chart
2. Cross-timeframe trend alignment and confluence
3. Entry timing optimization using multiple perspectives
4. Risk assessment considering broader market context
5. MNQ-specific scalping insights with session timing
6. Enhanced setup quality from multi-timeframe confirmation

Provide only the JSON response without additional text.`;
  }

  parseMultiTimeframeResponse(analysisText) {
    try {
      const jsonMatch = analysisText.match(/\{[\s\S]*\}/);

      if (!jsonMatch) {
        throw new Error('No valid JSON found in multi-timeframe analysis response');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      // Validate and extract the enhanced analysis section
      const enhanced = parsed.enhanced_analysis || {};

      return {
        // Individual timeframe analysis
        individual_timeframe_analysis: parsed.individual_timeframe_analysis || {},

        // Cross-timeframe analysis
        cross_timeframe_analysis: parsed.cross_timeframe_analysis || {},

        // Enhanced single analysis for compatibility
        setup_quality: Math.max(1, Math.min(10, enhanced.setup_quality || 5)),
        risk_reward_ratio: Math.max(0, enhanced.risk_reward_ratio || 1),
        pattern_type: this.validatePattern(enhanced.pattern_type) || 'unknown',
        entry_quality: this.validateQuality(enhanced.entry_quality) || 'fair',
        stop_placement: this.validatePlacement(enhanced.stop_placement) || 'unclear',
        target_selection: this.validateSelection(enhanced.target_selection) || 'unclear',
        ai_commentary: enhanced.ai_commentary || 'Multi-timeframe analysis completed',
        risk_amount: Math.max(0, enhanced.risk_amount || 0),
        within_limits: enhanced.within_limits === true,
        session_timing: this.validateTiming(enhanced.session_timing) || 'acceptable',
        trade_frequency: enhanced.trade_frequency || 'Unknown frequency assessment',
        learning_insights: enhanced.learning_insights || 'Multi-timeframe patterns analyzed',
        recommendation: this.validateRecommendation(enhanced.recommendation) || 'WAIT',
        confidence_score: Math.max(0, Math.min(1, enhanced.confidence_score || 0.5)),
        specific_observations: Array.isArray(enhanced.specific_observations)
          ? enhanced.specific_observations
          : ['Multi-timeframe analysis completed'],

        // Multi-timeframe specific fields
        timeframe_confluence_score: Math.max(0, Math.min(1, parsed.timeframe_confluence_score || 0.5)),
        analysis_confidence: Math.max(0, Math.min(1, parsed.analysis_confidence || 0.5)),
        multi_timeframe_insights: parsed.multi_timeframe_insights || 'Additional insights from multiple timeframes',
        trend_alignment_score: Math.max(0, Math.min(1, parsed.trend_alignment_score || 0.5)),
        structure_confirmation: parsed.structure_confirmation || 'Structure analysis completed'
      };

    } catch (error) {
      console.error('Failed to parse multi-timeframe analysis response:', error);

      return {
        individual_timeframe_analysis: {},
        cross_timeframe_analysis: {},
        setup_quality: 5,
        risk_reward_ratio: 1,
        pattern_type: 'unknown',
        entry_quality: 'fair',
        stop_placement: 'unclear',
        target_selection: 'unclear',
        ai_commentary: 'Multi-timeframe analysis parsing failed. Manual review recommended.',
        risk_amount: 0,
        within_limits: false,
        session_timing: 'unclear',
        trade_frequency: 'Unable to assess',
        learning_insights: 'Analysis incomplete',
        recommendation: 'SKIP',
        confidence_score: 0.1,
        specific_observations: ['Multi-timeframe parsing error occurred'],
        timeframe_confluence_score: 0.1,
        analysis_confidence: 0.1,
        multi_timeframe_insights: 'Analysis incomplete due to parsing error',
        trend_alignment_score: 0.1,
        structure_confirmation: 'Analysis incomplete'
      };
    }
  }

  // Calculate completeness score based on timeframes uploaded
  calculateCompletenessScore(timeframes) {
    const baseScore = 60; // Single timeframe baseline
    const timeframeBonus = {
      '1min': 10,
      '5min': 15,
      '15min': 10,
      'daily': 5
    };

    let totalScore = baseScore;
    timeframes.forEach(tf => totalScore += timeframeBonus[tf] || 0);

    // Confluence bonus for multiple timeframes
    if (timeframes.length >= 3) totalScore += 10;
    if (timeframes.length === 4) totalScore += 5;

    return Math.min(totalScore, 100);
  }

  // Universal timeframe analysis method with MNQ specialization
  async analyzeUniversalTimeframeScreenshots(timeframeFiles, tradingContext = {}, hierarchyData) {
    if (!this.apiKey) {
      throw new Error('Anthropic API key not configured');
    }

    try {
      const timeframes = Object.keys(timeframeFiles).sort();
      const imageContents = [];
      const fileAnalysis = {};

      // Process each timeframe image
      for (const timeframe of timeframes) {
        const file = timeframeFiles[timeframe][0]; // Get first file from array
        const imageData = this.encodeImageToBase64(file.path);
        const mediaType = this.getMediaType(path.extname(file.path).toLowerCase());

        fileAnalysis[timeframe] = {
          path: file.relativePath,
          filename: file.filename,
          category: hierarchyData.classified_timeframes.find(tf =>
            tf.timeframe_label === timeframe
          )?.classification.category || 'unknown'
        };

        imageContents.push({
          type: 'text',
          text: `\n=== ${timeframe.toUpperCase()} TIMEFRAME CHART ===`
        });

        imageContents.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: mediaType,
            data: imageData
          }
        });
      }

      const prompt = this.buildUniversalAnalysisPrompt(timeframes, tradingContext, hierarchyData);

      const response = await axios.post(
        this.apiUrl,
        {
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 4000,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: prompt
                },
                ...imageContents
              ]
            }
          ]
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.apiKey,
            'anthropic-version': '2023-06-01'
          },
          timeout: 60000
        }
      );

      const analysisText = response.data.content[0].text;
      const parsedAnalysis = this.parseUniversalTimeframeResponse(analysisText);

      return {
        ...parsedAnalysis,
        file_analysis: fileAnalysis,
        timeframes_analyzed: timeframes,
        trading_context: tradingContext,
        hierarchy_data: hierarchyData,
        analysis_type: 'universal_timeframe'
      };

    } catch (error) {
      console.error('Claude Universal Analysis Error:', error.response?.data || error.message);

      if (error.response?.status === 401) {
        throw new Error('Invalid Anthropic API key');
      } else if (error.response?.status === 429) {
        throw new Error('API rate limit exceeded. Please try again later.');
      } else if (error.code === 'ECONNABORTED') {
        throw new Error('Universal timeframe analysis request timed out');
      } else {
        const apiError = new Error('Failed to analyze universal timeframe screenshots');
        apiError.code = 'ANTHROPIC_API_ERROR';
        throw apiError;
      }
    }
  }

  // Frontend-compatible analysis method
  async analyzeFrontendTimeframeScreenshots(timeframeFiles, tradingContext = {}, hierarchyData) {
    if (!this.apiKey) {
      throw new Error('Anthropic API key not configured');
    }

    try {
      const timeframes = Object.keys(timeframeFiles).sort();
      const imageContents = [];
      const fileAnalysis = {};

      // Process each timeframe image
      for (const timeframe of timeframes) {
        const file = timeframeFiles[timeframe][0];
        const imageData = this.encodeImageToBase64(file.path);
        const mediaType = this.getMediaType(path.extname(file.path).toLowerCase());

        fileAnalysis[timeframe] = {
          path: file.relativePath,
          filename: file.filename,
          category: hierarchyData.classified_timeframes.find(tf =>
            tf.timeframe_label === timeframe
          )?.classification.category || 'unknown'
        };

        imageContents.push({
          type: 'text',
          text: `\n=== ${timeframe.toUpperCase()} TIMEFRAME CHART ===`
        });

        imageContents.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: mediaType,
            data: imageData
          }
        });
      }

      const prompt = this.buildFrontendAnalysisPrompt(timeframes, tradingContext, hierarchyData);

      const response = await axios.post(
        this.apiUrl,
        {
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 4000,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: prompt
                },
                ...imageContents
              ]
            }
          ]
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.apiKey,
            'anthropic-version': '2023-06-01'
          },
          timeout: 60000
        }
      );

      const analysisText = response.data.content[0].text;
      const parsedAnalysis = this.parseFrontendResponse(analysisText);

      return {
        ...parsedAnalysis,
        file_analysis: fileAnalysis,
        timeframes_analyzed: timeframes,
        trading_context: tradingContext,
        hierarchy_data: hierarchyData,
        analysis_type: 'frontend_compatible'
      };

    } catch (error) {
      console.error('Claude Frontend Analysis Error:', error.response?.data || error.message);

      if (error.response?.status === 401) {
        throw new Error('Invalid Anthropic API key');
      } else if (error.response?.status === 429) {
        throw new Error('API rate limit exceeded. Please try again later.');
      } else if (error.code === 'ECONNABORTED') {
        return res.status(504).json({
          success: false,
          error: 'SERVER_TIMEOUT',
          message: 'Analysis is taking longer than expected. Please try again.',
          code: 504
        });
      } else {
        const apiError = new Error('Failed to analyze screenshots');
        apiError.code = 'ANTHROPIC_API_ERROR';
        throw apiError;
      }
    }
  }

  buildFrontendAnalysisPrompt(timeframes, tradingContext, hierarchyData) {
    const currentWeek = this.getCurrentWeekNumber();
    const currentYear = new Date().getFullYear();
    const timeframesList = timeframes.join(', ');
    const primaryTimeframe = tradingContext.primary_timeframe || timeframes[0];

    // Build timeframe hierarchy description
    const hierarchy = hierarchyData.hierarchy;
    let hierarchyDesc = 'Timeframe Analysis Hierarchy:\n';
    if (hierarchy.entry_timeframe) {
      hierarchyDesc += `- Entry Timing: ${hierarchy.entry_timeframe.timeframe_label} (${hierarchy.entry_timeframe.classification.category})\n`;
    }
    if (hierarchy.structure_timeframe) {
      hierarchyDesc += `- Structure Analysis: ${hierarchy.structure_timeframe.timeframe_label} (${hierarchy.structure_timeframe.classification.category})\n`;
    }
    if (hierarchy.trend_timeframe) {
      hierarchyDesc += `- Trend Context: ${hierarchy.trend_timeframe.timeframe_label} (${hierarchy.trend_timeframe.classification.category})\n`;
    }
    if (hierarchy.bias_timeframe) {
      hierarchyDesc += `- Market Bias: ${hierarchy.bias_timeframe.timeframe_label} (${hierarchy.bias_timeframe.classification.category})\n`;
    }

    // MNQ specialization context
    const mnqSpecialization = tradingContext.instrument === 'MNQ' && (tradingContext.trading_style === 'scalping' || tradingContext.trading_style === 'mnq_scalping');

    return `You are analyzing trading screenshots for frontend display with specific section requirements.

FRONTEND DISPLAY REQUIREMENTS:
The analysis will be displayed in these exact sections:

1. Overall Setup Grade (A-F scale with + and -):
   - Letter grade: A+, A, A-, B+, B, B-, C+, C, C-, D, F
   - Brief description focusing on setup quality, risk management, timing
   - Numeric score out of 10

2. Pattern Recognition:
   - Primary pattern name (be specific and descriptive)
   - Confirmation status: "Confirmed", "Pending", "Weak"
   - Volume profile: "Strong", "Average", "Weak"
   - Market structure: "Bullish", "Bearish", "Neutral"

3. Risk Analysis:
   - Risk/reward ratio in X:1 format
   - Stop placement: "Optimal", "Good", "Needs Improvement"
   - Position sizing: "Conservative", "Appropriate", "Aggressive"

4. Detailed Insights:
   - Strengths: 3-4 specific bullet points
   - Improvements: 2-3 specific actionable suggestions

5. Recommended Actions:
   - 2-3 specific next steps for execution
   - Entry/exit timing guidance

TRADING CONTEXT:
Timeframes: ${timeframesList}
Primary: ${primaryTimeframe}
Instrument: ${tradingContext.instrument}
Style: ${tradingContext.trading_style}
Session: ${tradingContext.session_info}
Account: $${tradingContext.account_size}

${hierarchyDesc}

${mnqSpecialization ? `
MNQ SCALPING SPECIALIZATION:
- Focus on 9:30-10:15 AM session optimization
- $50 maximum risk per trade enforcement
- 0.75% weekly target context
- Point value: $2 per point for position sizing
- Session quality affects grading
` : `
GENERAL TRADING ANALYSIS:
- Adapt analysis to ${tradingContext.trading_style} style
- Consider ${tradingContext.instrument} characteristics
- Account size appropriate position sizing
`}

RESPONSE FORMAT (JSON):
{
  "overall_setup_grade": {
    "grade": "B+",
    "description": "Strong technical setup with good risk management",
    "score": 8.5
  },
  "pattern_recognition": {
    "primary_pattern": "Bull Flag Breakout",
    "confirmation_status": "Confirmed",
    "volume_profile": "Strong",
    "market_structure": "Bullish"
  },
  "risk_analysis": {
    "risk_reward_ratio": "2.8:1",
    "stop_placement": "Optimal",
    "position_size": "Conservative"
  },
  "detailed_insights": {
    "strengths": [
      "Clear pattern confirmation above key resistance",
      "Strong volume profile supporting breakout",
      "Well-defined stop loss below pattern support",
      "Favorable risk/reward ratio for scalping"
    ],
    "improvements": [
      "Could optimize entry timing for better fill",
      "Consider scaling out strategy at first target"
    ]
  },
  "recommended_actions": [
    "Monitor for breakout confirmation above ${tradingContext.instrument} resistance level",
    "Scale out 50% position at first target (2:1 R:R)",
    "Trail stop loss to breakeven after initial target hit"
  ],
  "screenshots": {
    "primary_timeframe": "${primaryTimeframe}",
    "available_timeframes": [${timeframes.map(tf => `"${tf}"`).join(', ')}]
  },
  "confidence_score": 0.85,
  "analysis_confidence": "High",
  "session_quality": "${mnqSpecialization ? 'optimal|good|fair|poor' : 'good'}",
  "risk_amount_dollars": 45
}

Provide specific, actionable analysis tailored to ${tradingContext.trading_style} style. Focus on frontend display requirements with clear, concise insights.

Provide only the JSON response without additional text.`;
  }

  parseFrontendResponse(analysisText) {
    try {
      const jsonMatch = analysisText.match(/\{[\s\S]*\}/);

      if (!jsonMatch) {
        throw new Error('No valid JSON found in frontend analysis response');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      return {
        overall_setup_grade: parsed.overall_setup_grade || {
          grade: 'C',
          description: 'Analysis completed',
          score: 5.0
        },
        pattern_recognition: parsed.pattern_recognition || {
          primary_pattern: 'Unknown Pattern',
          confirmation_status: 'Pending',
          volume_profile: 'Average',
          market_structure: 'Neutral'
        },
        risk_analysis: parsed.risk_analysis || {
          risk_reward_ratio: '2:1',
          stop_placement: 'Needs Improvement',
          position_size: 'Appropriate'
        },
        detailed_insights: parsed.detailed_insights || {
          strengths: ['Analysis completed successfully'],
          improvements: ['Manual review recommended']
        },
        recommended_actions: Array.isArray(parsed.recommended_actions)
          ? parsed.recommended_actions
          : ['Review analysis for execution guidance'],
        screenshots: parsed.screenshots || {
          primary_timeframe: 'unknown',
          available_timeframes: []
        },
        confidence_score: Math.max(0, Math.min(1, parsed.confidence_score || 0.5)),
        analysis_confidence: parsed.analysis_confidence || 'Moderate',
        session_quality: parsed.session_quality || 'good',
        risk_amount_dollars: parsed.risk_amount_dollars || 50
      };

    } catch (error) {
      console.error('Failed to parse frontend analysis response:', error);

      return {
        overall_setup_grade: {
          grade: 'C',
          description: 'Analysis parsing failed. Manual review recommended.',
          score: 5.0
        },
        pattern_recognition: {
          primary_pattern: 'Analysis Error',
          confirmation_status: 'Unknown',
          volume_profile: 'Unknown',
          market_structure: 'Unknown'
        },
        risk_analysis: {
          risk_reward_ratio: '2:1',
          stop_placement: 'Needs Review',
          position_size: 'Unknown'
        },
        detailed_insights: {
          strengths: ['Upload successful'],
          improvements: ['Analysis parsing failed - manual review needed']
        },
        recommended_actions: ['Review screenshot manually for trading decision'],
        screenshots: {
          primary_timeframe: 'unknown',
          available_timeframes: []
        },
        confidence_score: 0.1,
        analysis_confidence: 'Low',
        session_quality: 'unknown',
        risk_amount_dollars: 50
      };
    }
  }

  buildUniversalAnalysisPrompt(timeframes, tradingContext, hierarchyData) {
    const currentWeek = this.getCurrentWeekNumber();
    const currentYear = new Date().getFullYear();
    const timeframesList = timeframes.join(', ');
    const primaryTimeframe = tradingContext.primary_timeframe || timeframes[0];

    // Build timeframe hierarchy description
    const hierarchy = hierarchyData.hierarchy;
    let hierarchyDesc = 'Timeframe Analysis Hierarchy:\n';
    if (hierarchy.entry_timeframe) {
      hierarchyDesc += `- Entry Timing: ${hierarchy.entry_timeframe.timeframe_label} (${hierarchy.entry_timeframe.classification.category})\n`;
    }
    if (hierarchy.structure_timeframe) {
      hierarchyDesc += `- Structure Analysis: ${hierarchy.structure_timeframe.timeframe_label} (${hierarchy.structure_timeframe.classification.category})\n`;
    }
    if (hierarchy.trend_timeframe) {
      hierarchyDesc += `- Trend Context: ${hierarchy.trend_timeframe.timeframe_label} (${hierarchy.trend_timeframe.classification.category})\n`;
    }
    if (hierarchy.bias_timeframe) {
      hierarchyDesc += `- Market Bias: ${hierarchy.bias_timeframe.timeframe_label} (${hierarchy.bias_timeframe.classification.category})\n`;
    }

    // MNQ specialization context
    const mnqSpecialization = tradingContext.instrument === 'MNQ' && tradingContext.trading_style === 'mnq_scalping';

    return `You are analyzing trading screenshots with flexible timeframe inputs while maintaining specialized expertise in ${tradingContext.instrument} ${tradingContext.trading_style}.

UNIVERSAL TIMEFRAME CONTEXT:
Timeframes Provided: ${timeframesList}
Primary Analysis Timeframe: ${primaryTimeframe}
Trading Instrument: ${tradingContext.instrument}
Trading Style: ${tradingContext.trading_style}
Session Time: ${tradingContext.session_info}

${hierarchyDesc}

${mnqSpecialization ? `
MNQ SCALPING SPECIALIZATION CONTEXT:
- Account Size: $${tradingContext.account_size}
- Risk Per Trade: $50 maximum (1% account rule)
- Target: 0.75% weekly returns through disciplined execution
- Session Focus: Opening hours (9:30-10:15 AM EST) optimal
- 5-Year Plan: $500 → $951,000 systematic wealth building
- Current Week: ${currentWeek}, ${currentYear}
` : `
GENERAL TRADING CONTEXT:
- Instrument: ${tradingContext.instrument}
- Trading Style: ${tradingContext.trading_style}
- Session: ${tradingContext.session_info}
- Account Management: Professional risk controls
`}

ANALYSIS FRAMEWORK:

1. **Universal Timeframe Classification:**
   ${hierarchyData.classified_timeframes.map(tf =>
     `- ${tf.timeframe_label}: ${tf.classification.category} (${tf.classification.priority} focus)`
   ).join('\n   ')}

2. **Cross-Timeframe Confluence Analysis:**
   - Analyze trend alignment across all provided timeframes
   - Assess structural confirmation between timeframe levels
   - Optimize entry/exit timing based on timeframe hierarchy
   - Calculate risk/reward from multiple timeframe perspectives

3. **Instrument-Specific Analysis:**${mnqSpecialization ? `
   - MNQ volatility patterns and session behavior
   - Micro futures spread and liquidity considerations
   - Volume profile implications for scalping precision
   - News sensitivity during regular trading hours
   - Opening session momentum characteristics` : `
   - Instrument-specific volatility and behavior patterns
   - Market structure and liquidity considerations
   - Volume and momentum characteristics
   - Session-specific trading opportunities`}

4. **Trading Style Optimization:**
   - ${tradingContext.trading_style === 'mnq_scalping' ? 'Scalping: Precision entry/exit timing with 5-15 point targets' :
       tradingContext.trading_style === 'swing' ? 'Swing: Multi-day holds with higher timeframe emphasis' :
       tradingContext.trading_style === 'position' ? 'Position: Weekly/monthly structure priority' :
       'Adaptive analysis based on provided timeframes'}

5. **Risk Management Context:**${mnqSpecialization ? `
   - $50 maximum risk per trade enforcement
   - Position sizing for MNQ point value ($2 per point)
   - Session-specific risk adjustments
   - Account heat management (${((50 / tradingContext.account_size) * 100).toFixed(2)}% max per trade)` : `
   - Professional risk management principles
   - Position sizing appropriate for account and instrument
   - Risk-adjusted expectations based on trading style`}

Return comprehensive JSON analysis:

{
  "universal_timeframe_analysis": {
    "timeframes_analyzed": [${timeframes.map(tf => `"${tf}"`).join(', ')}],
    "primary_timeframe": "${primaryTimeframe}",
    "timeframe_hierarchy": {
      "entry_timeframe": "${hierarchy.entry_timeframe?.timeframe_label || 'none'}",
      "structure_timeframe": "${hierarchy.structure_timeframe?.timeframe_label || 'none'}",
      "trend_timeframe": "${hierarchy.trend_timeframe?.timeframe_label || 'none'}"
    },
    "cross_timeframe_confluence": "strong|moderate|weak|conflicting"
  },
  "individual_timeframe_analysis": {
    ${timeframes.map(tf => `"${tf}": {
      "pattern_identified": "specific pattern on ${tf}",
      "trend_direction": "bullish|bearish|neutral",
      "key_levels": ["level1", "level2", "level3"],
      "volume_analysis": "volume characteristics",
      "setup_quality": 1-10,
      "timeframe_role": "entry|structure|trend|bias"
    }`).join(',\n    ')}
  },
  ${mnqSpecialization ? `"mnq_specialized_insights": {
    "scalping_appropriateness": 1-10,
    "session_timing_quality": "optimal|good|fair|poor",
    "micro_structure_analysis": "MNQ-specific microstructure insights",
    "volatility_assessment": "high|moderate|low with MNQ context",
    "risk_reward_mnq_context": "R:R ratio with MNQ volatility context"
  },` : `"instrument_insights": {
    "trading_appropriateness": 1-10,
    "session_quality": "optimal|good|fair|poor",
    "market_structure": "instrument-specific insights",
    "volatility_context": "volatility assessment for ${tradingContext.instrument}"
  },`}
  "enhanced_analysis": {
    "setup_quality": 1-10,
    "risk_reward_ratio": "calculated R:R",
    "pattern_type": "dominant confluence pattern",
    "entry_quality": "excellent|good|fair|poor",
    "stop_placement": "appropriate|too_tight|too_wide",
    "target_selection": "realistic|aggressive|conservative",
    "ai_commentary": "Comprehensive universal timeframe analysis with specialization",
    "risk_amount": "estimated risk in dollars",
    "within_limits": true|false,
    "session_timing": "optimal|acceptable|poor",
    "trade_frequency": "frequency assessment",
    "learning_insights": "cross-timeframe insights and pattern recognition",
    "recommendation": "EXECUTE|WAIT|SKIP",
    "confidence_score": 0-1,
    "specific_observations": ["key observations from timeframe analysis"]
  },
  "analysis_confidence": 0-1,
  "completeness_score": ${hierarchyData.analysis_completeness}
}

Focus on providing analysis that works for any timeframe combination while delivering expert ${tradingContext.instrument} insights when applicable. Adapt analysis depth to match the trading style and available timeframe hierarchy.

Provide only the JSON response without additional text.`;
  }

  parseUniversalTimeframeResponse(analysisText) {
    try {
      const jsonMatch = analysisText.match(/\{[\s\S]*\}/);

      if (!jsonMatch) {
        throw new Error('No valid JSON found in universal timeframe analysis response');
      }

      const parsed = JSON.parse(jsonMatch[0]);
      const enhanced = parsed.enhanced_analysis || {};

      return {
        // Universal timeframe analysis
        universal_timeframe_analysis: parsed.universal_timeframe_analysis || {},
        individual_timeframe_analysis: parsed.individual_timeframe_analysis || {},

        // Specialized insights (MNQ or general)
        specialized_insights: parsed.mnq_specialized_insights || parsed.instrument_insights || {},

        // Enhanced analysis for compatibility
        setup_quality: Math.max(1, Math.min(10, enhanced.setup_quality || 5)),
        risk_reward_ratio: Math.max(0, enhanced.risk_reward_ratio || 1),
        pattern_type: this.validatePattern(enhanced.pattern_type) || 'confluence_pattern',
        entry_quality: this.validateQuality(enhanced.entry_quality) || 'fair',
        stop_placement: this.validatePlacement(enhanced.stop_placement) || 'unclear',
        target_selection: this.validateSelection(enhanced.target_selection) || 'unclear',
        ai_commentary: enhanced.ai_commentary || 'Universal timeframe analysis completed',
        risk_amount: Math.max(0, enhanced.risk_amount || 0),
        within_limits: enhanced.within_limits === true,
        session_timing: this.validateTiming(enhanced.session_timing) || 'acceptable',
        trade_frequency: enhanced.trade_frequency || 'Universal timeframe assessment',
        learning_insights: enhanced.learning_insights || 'Cross-timeframe patterns analyzed',
        recommendation: this.validateRecommendation(enhanced.recommendation) || 'WAIT',
        confidence_score: Math.max(0, Math.min(1, enhanced.confidence_score || 0.5)),
        specific_observations: Array.isArray(enhanced.specific_observations)
          ? enhanced.specific_observations
          : ['Universal timeframe analysis completed'],

        // Universal specific fields
        analysis_confidence: Math.max(0, Math.min(1, parsed.analysis_confidence || 0.5)),
        completeness_score: Math.max(0, Math.min(100, parsed.completeness_score || 70))
      };

    } catch (error) {
      console.error('Failed to parse universal timeframe analysis response:', error);

      return {
        universal_timeframe_analysis: { timeframes_analyzed: [], cross_timeframe_confluence: 'unknown' },
        individual_timeframe_analysis: {},
        specialized_insights: {},
        setup_quality: 5,
        risk_reward_ratio: 1,
        pattern_type: 'unknown',
        entry_quality: 'fair',
        stop_placement: 'unclear',
        target_selection: 'unclear',
        ai_commentary: 'Universal timeframe analysis parsing failed. Manual review recommended.',
        risk_amount: 0,
        within_limits: false,
        session_timing: 'unclear',
        trade_frequency: 'Unable to assess',
        learning_insights: 'Analysis incomplete',
        recommendation: 'SKIP',
        confidence_score: 0.1,
        specific_observations: ['Universal timeframe parsing error occurred'],
        analysis_confidence: 0.1,
        completeness_score: 50
      };
    }
  }
}

module.exports = ClaudeAnalysisService;