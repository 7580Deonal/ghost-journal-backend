/**
 * MNQ Specialization Layer
 * Provides expert-level MNQ futures analysis while supporting universal timeframes
 */

/**
 * Analyze session timing for MNQ scalping
 * @param {string} sessionTime - Time in format "9:35 AM" or "09:35"
 * @returns {object} Session analysis with quality and risk adjustment
 */
const analyzeSessionTiming = (sessionTime) => {
  if (!sessionTime) {
    return {
      quality: 'unknown',
      reason: 'Session time not provided',
      risk_adjustment: 0.8,
      mnq_context: 'Unable to assess session timing'
    };
  }

  try {
    // Parse various time formats
    let timeStr = sessionTime.toString().toLowerCase();
    let hour = 0;
    let minute = 0;

    // Handle "9:35 AM" format
    const ampmMatch = timeStr.match(/(\d{1,2}):?(\d{2})?\s*(am|pm)/);
    if (ampmMatch) {
      hour = parseInt(ampmMatch[1]);
      minute = parseInt(ampmMatch[2] || 0);
      if (ampmMatch[3] === 'pm' && hour !== 12) hour += 12;
      if (ampmMatch[3] === 'am' && hour === 12) hour = 0;
    } else {
      // Handle 24-hour format "09:35" or "935"
      const timeMatch = timeStr.match(/(\d{1,2}):?(\d{2})/);
      if (timeMatch) {
        hour = parseInt(timeMatch[1]);
        minute = parseInt(timeMatch[2]);
      }
    }

    const timeDecimal = hour + (minute / 60);

    // MNQ optimal session analysis (Eastern Time)
    if (timeDecimal >= 9.5 && timeDecimal < 10.25) { // 9:30 AM - 10:15 AM
      return {
        quality: 'optimal',
        reason: 'Opening session - peak MNQ volatility and volume',
        risk_adjustment: 1.0,
        mnq_context: 'Ideal for MNQ scalping with high probability setups',
        session_characteristics: [
          'Maximum volatility and movement',
          'Institutional order flow active',
          'Clear directional bias development',
          'Optimal risk/reward ratios available'
        ]
      };
    } else if (timeDecimal >= 10.25 && timeDecimal < 11.5) { // 10:15 AM - 11:30 AM
      return {
        quality: 'good',
        reason: 'Mid-morning momentum - reduced but viable volatility',
        risk_adjustment: 0.85,
        mnq_context: 'Good for experienced MNQ scalpers with refined setups',
        session_characteristics: [
          'Moderate volatility continuation',
          'Trend continuation patterns',
          'Lower volume than opening',
          'Requires higher precision'
        ]
      };
    } else if (timeDecimal >= 11.5 && timeDecimal < 13) { // 11:30 AM - 1:00 PM
      return {
        quality: 'fair',
        reason: 'Lunch period - consolidation and reduced volume',
        risk_adjustment: 0.7,
        mnq_context: 'Challenging for MNQ scalping - range-bound conditions',
        session_characteristics: [
          'Consolidation patterns dominant',
          'Reduced institutional participation',
          'Lower probability setups',
          'Risk of whipsaws increases'
        ]
      };
    } else if (timeDecimal >= 13 && timeDecimal < 15) { // 1:00 PM - 3:00 PM
      return {
        quality: 'acceptable',
        reason: 'Afternoon session - moderate activity resumption',
        risk_adjustment: 0.8,
        mnq_context: 'Selective MNQ opportunities with careful risk management',
        session_characteristics: [
          'Gradual volume increase',
          'Institutional re-engagement',
          'Setup quality improvement',
          'Preparation for close'
        ]
      };
    } else if (timeDecimal >= 15 && timeDecimal < 16) { // 3:00 PM - 4:00 PM
      return {
        quality: 'good',
        reason: 'Market close approach - increased volatility',
        risk_adjustment: 0.9,
        mnq_context: 'Strong MNQ opportunities but requires experience',
        session_characteristics: [
          'Closing auction preparation',
          'Institutional positioning',
          'Higher volatility return',
          'Time-sensitive execution'
        ]
      };
    } else {
      return {
        quality: 'poor',
        reason: 'Outside regular trading hours or low activity period',
        risk_adjustment: 0.6,
        mnq_context: 'Not recommended for MNQ scalping',
        session_characteristics: [
          'Extended hours conditions',
          'Reduced liquidity',
          'Wider spreads possible',
          'Lower probability setups'
        ]
      };
    }
  } catch (error) {
    return {
      quality: 'unknown',
      reason: 'Unable to parse session time',
      risk_adjustment: 0.8,
      mnq_context: 'Session timing analysis failed',
      session_characteristics: ['Manual time verification required']
    };
  }
};

/**
 * Assess scalping conditions for MNQ
 * @param {Array} classifiedTimeframes - Array of classified timeframes
 * @param {object} tradingContext - Trading context including session info
 * @returns {object} MNQ scalping suitability assessment
 */
const assessMNQScalpingConditions = (classifiedTimeframes, tradingContext) => {
  const sessionAnalysis = analyzeSessionTiming(tradingContext.session_info);
  const ultraShortFrames = classifiedTimeframes.filter(tf => tf.classification.category === 'ultra_short');
  const structureFrames = classifiedTimeframes.filter(tf => tf.classification.category === 'short_term');

  let suitabilityScore = 0;
  let conditions = [];
  let warnings = [];

  // Session timing impact (40% of score)
  const sessionScore = sessionAnalysis.risk_adjustment * 40;
  suitabilityScore += sessionScore;
  conditions.push(`Session timing: ${sessionAnalysis.quality} (${Math.round(sessionScore)}pts)`);

  // Timeframe suitability (35% of score)
  let timeframeScore = 0;
  if (ultraShortFrames.length >= 1) {
    timeframeScore += 20;
    conditions.push('Entry timeframe available for precise execution');
  } else {
    warnings.push('No ultra-short timeframe for precise entry timing');
  }

  if (structureFrames.length >= 1) {
    timeframeScore += 15;
    conditions.push('Structure timeframe provides confluence');
  } else {
    warnings.push('No structure timeframe for setup confirmation');
  }

  suitabilityScore += timeframeScore;

  // Account size and risk management (15% of score)
  const accountSize = parseFloat(tradingContext.account_size) || 0;
  let riskScore = 0;
  if (accountSize >= 25000) {
    riskScore = 15;
    conditions.push('Adequate account size for MNQ scalping');
  } else if (accountSize >= 10000) {
    riskScore = 10;
    conditions.push('Minimum account size for careful MNQ scalping');
  } else {
    riskScore = 5;
    warnings.push('Account size may be too small for optimal MNQ risk management');
  }
  suitabilityScore += riskScore;

  // Experience level inference (10% of score)
  let experienceScore = 10; // Assume intermediate by default
  suitabilityScore += experienceScore;

  // Determine overall suitability
  let overall = 'poor';
  if (suitabilityScore >= 80) {
    overall = 'excellent';
  } else if (suitabilityScore >= 65) {
    overall = 'good';
  } else if (suitabilityScore >= 50) {
    overall = 'fair';
  }

  return {
    overall_suitability: overall,
    suitability_score: Math.round(suitabilityScore),
    session_analysis: sessionAnalysis,
    favorable_conditions: conditions,
    warnings: warnings,
    recommendations: generateMNQRecommendations(overall, sessionAnalysis, classifiedTimeframes)
  };
};

/**
 * Calculate MNQ-specific risk parameters
 * @param {number} accountSize - Account size in dollars
 * @param {object} sessionAnalysis - Session timing analysis
 * @returns {object} Risk management parameters
 */
const calculateMNQRiskParameters = (accountSize, sessionAnalysis) => {
  const baseRisk = 50; // $50 maximum risk per trade
  const adjustedRisk = baseRisk * sessionAnalysis.risk_adjustment;

  // MNQ typical point values and spreads
  const mnqPointValue = 2; // $2 per point for MNQ
  const typicalSpread = 0.25; // 0.25 points typical spread
  const avgDailyRange = 45; // Approximate daily range in points

  // Position sizing calculations
  const maxRiskPoints = adjustedRisk / mnqPointValue;
  const recommendedContracts = Math.floor(adjustedRisk / (avgDailyRange * mnqPointValue * 0.1)); // 10% of daily range risk

  return {
    max_risk_dollars: Math.round(adjustedRisk * 100) / 100,
    max_risk_points: Math.round(maxRiskPoints * 100) / 100,
    recommended_contracts: Math.max(1, recommendedContracts),
    point_value: mnqPointValue,
    typical_spread: typicalSpread,
    stop_buffer: typicalSpread * 2, // Minimum stop buffer
    risk_adjustment_factor: sessionAnalysis.risk_adjustment,
    account_heat_percentage: (adjustedRisk / accountSize * 100).toFixed(2)
  };
};

/**
 * Analyze MNQ microstructure considerations
 * @param {Array} classifiedTimeframes - Classified timeframes
 * @param {object} tradingContext - Trading context
 * @returns {object} Microstructure analysis
 */
const analyzeMNQMicrostructure = (classifiedTimeframes, tradingContext) => {
  const hasUltraShort = classifiedTimeframes.some(tf => tf.classification.category === 'ultra_short');
  const hasStructure = classifiedTimeframes.some(tf => tf.classification.category === 'short_term');

  const analysis = {
    liquidity_assessment: 'high', // MNQ generally has good liquidity
    spread_considerations: [],
    execution_insights: [],
    volume_profile_importance: 'high'
  };

  if (hasUltraShort) {
    analysis.execution_insights.push('Ultra-short timeframe allows for precise entry/exit timing');
    analysis.execution_insights.push('Tick-level analysis possible for optimal fills');
    analysis.spread_considerations.push('Monitor spread widening during low-volume periods');
  }

  if (hasStructure) {
    analysis.execution_insights.push('Structure timeframe helps identify institutional activity');
    analysis.volume_profile_importance = 'critical';
  }

  // Session-specific microstructure
  const sessionAnalysis = analyzeSessionTiming(tradingContext.session_info);
  if (sessionAnalysis.quality === 'optimal') {
    analysis.liquidity_assessment = 'excellent';
    analysis.spread_considerations.push('Tightest spreads expected during opening session');
  } else if (sessionAnalysis.quality === 'poor') {
    analysis.liquidity_assessment = 'reduced';
    analysis.spread_considerations.push('Wider spreads possible - use limit orders');
    analysis.execution_insights.push('Consider larger position size reduction due to execution risk');
  }

  return analysis;
};

/**
 * Generate MNQ-specific recommendations
 * @param {string} suitability - Overall suitability rating
 * @param {object} sessionAnalysis - Session timing analysis
 * @param {Array} timeframes - Classified timeframes
 * @returns {Array} Array of specific recommendations
 */
const generateMNQRecommendations = (suitability, sessionAnalysis, timeframes) => {
  const recommendations = [];

  // Session-based recommendations
  if (sessionAnalysis.quality === 'optimal') {
    recommendations.push('Execute with standard position size - optimal conditions');
    recommendations.push('Focus on breakout and momentum continuation patterns');
    recommendations.push('Target 0.25% - 0.5% account gains per trade');
  } else if (sessionAnalysis.quality === 'good') {
    recommendations.push('Reduce position size by 15% due to session timing');
    recommendations.push('Focus on higher-probability confluence setups');
    recommendations.push('Tighten profit targets to 0.2% - 0.3% account gains');
  } else if (sessionAnalysis.quality === 'fair') {
    recommendations.push('Reduce position size by 30% - challenging conditions');
    recommendations.push('Only take highest-conviction setups');
    recommendations.push('Consider paper trading during this session');
  } else {
    recommendations.push('Avoid trading - poor session conditions for MNQ scalping');
    recommendations.push('Use this time for market study and preparation');
  }

  // Timeframe-based recommendations
  const ultraShort = timeframes.filter(tf => tf.classification.category === 'ultra_short').length;
  const structure = timeframes.filter(tf => tf.classification.category === 'short_term').length;

  if (ultraShort === 0) {
    recommendations.push('Consider adding 1-5 minute timeframe for better entry timing');
  }

  if (structure === 0) {
    recommendations.push('Add 15-30 minute timeframe for structure confirmation');
  }

  if (ultraShort >= 1 && structure >= 1) {
    recommendations.push('Excellent timeframe combination for MNQ analysis');
    recommendations.push('Use structure for bias, ultra-short for timing');
  }

  return recommendations;
};

/**
 * Provide comprehensive MNQ insights
 * @param {object} timeframeData - Classified timeframe data
 * @param {object} tradingContext - Trading context
 * @returns {object} Complete MNQ specialization analysis
 */
const provideMNQInsights = (timeframeData, tradingContext) => {
  if (tradingContext.instrument !== 'MNQ' && tradingContext.trading_style !== 'mnq_scalping') {
    return null; // No MNQ specialization for other contexts
  }

  const scalpingConditions = assessMNQScalpingConditions(timeframeData.classified_timeframes, tradingContext);
  const riskParameters = calculateMNQRiskParameters(
    parseFloat(tradingContext.account_size) || 67500,
    scalpingConditions.session_analysis
  );
  const microstructure = analyzeMNQMicrostructure(timeframeData.classified_timeframes, tradingContext);

  return {
    specialization_type: 'mnq_scalping_expert',
    overall_assessment: scalpingConditions.overall_suitability,
    confidence_multiplier: scalpingConditions.suitability_score / 100,

    session_analysis: scalpingConditions.session_analysis,
    scalping_conditions: scalpingConditions,
    risk_parameters: riskParameters,
    microstructure_analysis: microstructure,

    key_insights: [
      `MNQ scalping suitability: ${scalpingConditions.overall_suitability} (${scalpingConditions.suitability_score}/100)`,
      `Session quality: ${scalpingConditions.session_analysis.quality} - ${scalpingConditions.session_analysis.reason}`,
      `Recommended risk: $${riskParameters.max_risk_dollars} (${riskParameters.account_heat_percentage}% account)`,
      `Contracts suggested: ${riskParameters.recommended_contracts}`
    ],

    trading_plan: {
      entry_strategy: timeframeData.hierarchy.entry_timeframe ?
        `Use ${timeframeData.hierarchy.entry_timeframe.timeframe_label} for precise entry timing` :
        'Add ultra-short timeframe for better entry precision',

      risk_management: `Max risk $${riskParameters.max_risk_dollars} (${riskParameters.max_risk_points} points) with ${riskParameters.stop_buffer} point buffer`,

      profit_targets: scalpingConditions.session_analysis.quality === 'optimal' ?
        '0.25% - 0.5% account target per trade' :
        '0.15% - 0.3% account target (reduced due to session)'
    },

    recommendations: scalpingConditions.recommendations
  };
};

module.exports = {
  analyzeSessionTiming,
  assessMNQScalpingConditions,
  calculateMNQRiskParameters,
  analyzeMNQMicrostructure,
  generateMNQRecommendations,
  provideMNQInsights
};