/**
 * Universal Timeframe Classification and Hierarchy System
 * Supports any user-defined timeframe while maintaining MNQ specialization
 */

/**
 * Classify a timeframe label into category and priority
 * @param {string} timeframeLabel - User-defined timeframe (e.g., '1min', '4hr', 'daily')
 * @returns {object} Classification with category and priority
 */
const classifyTimeframe = (timeframeLabel) => {
  const label = timeframeLabel.toLowerCase().trim();

  // Ultra-short timeframes (scalping focused)
  if (/^(15s|30s|1min|2min|3min|5min)$/.test(label)) {
    return {
      category: 'ultra_short',
      priority: 'entry_timing',
      weight: 1,
      mnq_suitability: 'excellent' // Perfect for MNQ scalping
    };
  }

  // Short-term timeframes (intraday structure)
  if (/^(10min|15min|30min|1hr|2hr|4hr)$/.test(label)) {
    return {
      category: 'short_term',
      priority: 'structure',
      weight: 2,
      mnq_suitability: 'good' // Good for MNQ structure confirmation
    };
  }

  // Medium-term timeframes (daily bias)
  if (/^(daily|1d|2d|3d)$/.test(label)) {
    return {
      category: 'medium_term',
      priority: 'trend',
      weight: 3,
      mnq_suitability: 'moderate' // Useful for MNQ daily bias
    };
  }

  // Long-term timeframes (weekly+ bias)
  if (/^(weekly|1w|monthly|1m|quarterly|yearly)$/.test(label)) {
    return {
      category: 'long_term',
      priority: 'bias',
      weight: 4,
      mnq_suitability: 'limited' // Less relevant for MNQ scalping
    };
  }

  // Handle numeric patterns (e.g., "240min", "4h")
  const numericMatch = label.match(/^(\d+)(min|m|h|hr|hours?|d|days?|w|weeks?|mo|months?)$/);
  if (numericMatch) {
    const value = parseInt(numericMatch[1]);
    const unit = numericMatch[2];

    if (unit.startsWith('min') || unit === 'm') {
      if (value <= 5) {
        return { category: 'ultra_short', priority: 'entry_timing', weight: 1, mnq_suitability: 'excellent' };
      } else if (value <= 60) {
        return { category: 'short_term', priority: 'structure', weight: 2, mnq_suitability: 'good' };
      }
    } else if (unit.startsWith('h') || unit === 'hr') {
      if (value <= 4) {
        return { category: 'short_term', priority: 'structure', weight: 2, mnq_suitability: 'good' };
      } else if (value <= 24) {
        return { category: 'medium_term', priority: 'trend', weight: 3, mnq_suitability: 'moderate' };
      }
    } else if (unit.startsWith('d')) {
      if (value <= 3) {
        return { category: 'medium_term', priority: 'trend', weight: 3, mnq_suitability: 'moderate' };
      } else {
        return { category: 'long_term', priority: 'bias', weight: 4, mnq_suitability: 'limited' };
      }
    } else if (unit.startsWith('w') || unit.startsWith('mo')) {
      return { category: 'long_term', priority: 'bias', weight: 4, mnq_suitability: 'limited' };
    }
  }

  // Unknown/custom timeframe
  return {
    category: 'custom',
    priority: 'context',
    weight: 2.5,
    mnq_suitability: 'unknown'
  };
};

/**
 * Determine timeframe hierarchy for analysis
 * @param {Array} timeframes - Array of timeframe objects with labels and classifications
 * @returns {object} Hierarchy with entry, structure, and trend timeframes
 */
const determineTimeframeHierarchy = (timeframes) => {
  const classified = timeframes.map(tf => ({
    ...tf,
    classification: classifyTimeframe(tf.timeframe_label || tf.label)
  })).sort((a, b) => a.classification.weight - b.classification.weight);

  const hierarchy = {
    entry_timeframe: null,
    structure_timeframe: null,
    trend_timeframe: null,
    bias_timeframe: null,
    primary_timeframe: null
  };

  // Find primary timeframe (either marked as primary or first ultra_short)
  hierarchy.primary_timeframe = classified.find(tf => tf.is_primary) || classified[0];

  // Assign timeframes to hierarchy roles
  for (const tf of classified) {
    const priority = tf.classification.priority;

    if (priority === 'entry_timing' && !hierarchy.entry_timeframe) {
      hierarchy.entry_timeframe = tf;
    } else if (priority === 'structure' && !hierarchy.structure_timeframe) {
      hierarchy.structure_timeframe = tf;
    } else if (priority === 'trend' && !hierarchy.trend_timeframe) {
      hierarchy.trend_timeframe = tf;
    } else if (priority === 'bias' && !hierarchy.bias_timeframe) {
      hierarchy.bias_timeframe = tf;
    }
  }

  return {
    hierarchy,
    classified_timeframes: classified,
    analysis_completeness: calculateCompletenessFromHierarchy(hierarchy)
  };
};

/**
 * Calculate analysis completeness score based on timeframe hierarchy
 * @param {object} hierarchy - Timeframe hierarchy object
 * @returns {number} Completeness score (0-100)
 */
const calculateCompletenessFromHierarchy = (hierarchy) => {
  let score = 40; // Base score

  if (hierarchy.entry_timeframe) score += 20;
  if (hierarchy.structure_timeframe) score += 25;
  if (hierarchy.trend_timeframe) score += 10;
  if (hierarchy.bias_timeframe) score += 5;

  return Math.min(score, 100);
};

/**
 * Assess MNQ scalping suitability for timeframe combination
 * @param {Array} classifiedTimeframes - Array of classified timeframes
 * @returns {object} MNQ suitability assessment
 */
const assessMNQScalpingSuitability = (classifiedTimeframes) => {
  const ultraShortCount = classifiedTimeframes.filter(tf => tf.classification.category === 'ultra_short').length;
  const shortTermCount = classifiedTimeframes.filter(tf => tf.classification.category === 'short_term').length;
  const totalCount = classifiedTimeframes.length;

  let suitability = 'poor';
  let score = 0;
  let recommendations = [];

  if (ultraShortCount >= 1) {
    score += 40;
    suitability = 'fair';
    recommendations.push('Ultra-short timeframe present for entry timing');
  }

  if (shortTermCount >= 1) {
    score += 30;
    if (suitability === 'fair') suitability = 'good';
    recommendations.push('Short-term timeframe provides structure context');
  }

  if (ultraShortCount >= 1 && shortTermCount >= 1) {
    score += 20;
    suitability = 'excellent';
    recommendations.push('Optimal combination for MNQ scalping analysis');
  }

  if (totalCount >= 3) {
    score += 10;
    recommendations.push('Multiple timeframes enhance confluence analysis');
  }

  return {
    suitability,
    score: Math.min(score, 100),
    recommendations,
    ideal_for_mnq: suitability === 'excellent' || suitability === 'good'
  };
};

/**
 * Generate analysis strategy based on timeframe combination
 * @param {object} hierarchyData - Result from determineTimeframeHierarchy
 * @param {string} tradingStyle - Trading style (e.g., 'mnq_scalping')
 * @returns {object} Analysis strategy configuration
 */
const generateAnalysisStrategy = (hierarchyData, tradingStyle = 'mnq_scalping') => {
  const { hierarchy, classified_timeframes } = hierarchyData;
  const mnqSuitability = assessMNQScalpingSuitability(classified_timeframes);

  const strategy = {
    analysis_focus: [],
    confidence_multiplier: 1.0,
    specialized_insights: [],
    analysis_depth: 'standard'
  };

  // Determine analysis focus based on available timeframes
  if (hierarchy.entry_timeframe) {
    strategy.analysis_focus.push('precision_entry_timing');
    strategy.confidence_multiplier += 0.2;
  }

  if (hierarchy.structure_timeframe) {
    strategy.analysis_focus.push('structural_confluence');
    strategy.confidence_multiplier += 0.25;
  }

  if (hierarchy.trend_timeframe) {
    strategy.analysis_focus.push('trend_alignment');
    strategy.confidence_multiplier += 0.15;
  }

  // MNQ-specific strategy adjustments
  if (tradingStyle === 'mnq_scalping') {
    if (mnqSuitability.ideal_for_mnq) {
      strategy.specialized_insights.push('mnq_session_analysis');
      strategy.specialized_insights.push('mnq_volatility_assessment');
      strategy.specialized_insights.push('micro_futures_considerations');
      strategy.analysis_depth = 'expert';
      strategy.confidence_multiplier += 0.1;
    }

    if (hierarchy.entry_timeframe?.classification.category === 'ultra_short') {
      strategy.specialized_insights.push('mnq_scalping_optimization');
      strategy.specialized_insights.push('session_timing_analysis');
    }
  }

  strategy.confidence_multiplier = Math.min(strategy.confidence_multiplier, 1.5);

  return {
    strategy,
    mnq_suitability: mnqSuitability,
    hierarchy_completeness: hierarchyData.analysis_completeness
  };
};

/**
 * Format timeframe data for database storage
 * @param {Array} timeframeFiles - Files with timeframe information
 * @param {object} hierarchyData - Hierarchy analysis result
 * @returns {object} Formatted data for database
 */
const formatTimeframeMetadata = (timeframeFiles, hierarchyData) => {
  const screenshots_metadata = Object.keys(timeframeFiles).map(timeframeLabel => {
    const file = timeframeFiles[timeframeLabel][0];
    const classification = classifyTimeframe(timeframeLabel);

    return {
      timeframe_label: timeframeLabel,
      screenshot_path: file.relativePath,
      filename: file.filename,
      file_size: file.size,
      timeframe_category: classification.category,
      timeframe_priority: classification.priority,
      mnq_suitability: classification.mnq_suitability,
      is_primary: timeframeLabel === hierarchyData.hierarchy.primary_timeframe?.timeframe_label
    };
  });

  return {
    screenshots_metadata: JSON.stringify(screenshots_metadata),
    timeframes_used: Object.keys(timeframeFiles).join(','),
    analysis_completeness_score: hierarchyData.analysis_completeness
  };
};

module.exports = {
  classifyTimeframe,
  determineTimeframeHierarchy,
  calculateCompletenessFromHierarchy,
  assessMNQScalpingSuitability,
  generateAnalysisStrategy,
  formatTimeframeMetadata
};