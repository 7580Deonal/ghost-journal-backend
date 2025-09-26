/**
 * Comprehensive Error Handling System
 * Provides consistent error codes, retry logic, and user-friendly messages
 */

// ERROR CODE DEFINITIONS
const ERROR_CODES = {
  // File validation errors
  'FILE_TOO_LARGE': {
    code: 413,
    message: 'Screenshot must be under 10MB',
    retry: false,
    user_action: 'Please compress your image or use a smaller file'
  },
  'INVALID_FORMAT': {
    code: 415,
    message: 'Only PNG, JPEG, and PDF files accepted',
    retry: false,
    user_action: 'Please convert your file to PNG, JPEG, or PDF format'
  },
  'CORRUPTED_FILE': {
    code: 422,
    message: 'File appears corrupted. Please try again',
    retry: true,
    user_action: 'Try uploading the file again, or use a different screenshot'
  },
  'NO_FILES_UPLOADED': {
    code: 400,
    message: 'Please upload at least one timeframe screenshot',
    retry: false,
    user_action: 'Select and upload your trading chart screenshots'
  },

  // Analysis errors
  'CHART_UNREADABLE': {
    code: 422,
    message: 'Chart not clearly visible. Please upload clearer screenshot',
    retry: true,
    user_action: 'Ensure your chart is clearly visible and try uploading again'
  },
  'NO_PATTERN_DETECTED': {
    code: 422,
    message: 'No recognizable trading pattern found',
    retry: false,
    user_action: 'Review your setup and ensure a clear trading pattern is visible'
  },
  'CLAUDE_API_TIMEOUT': {
    code: 504,
    message: 'Analysis taking longer than expected. Please retry',
    retry: true,
    user_action: 'Please wait a moment and try uploading again'
  },
  'CLAUDE_API_ERROR': {
    code: 503,
    message: 'AI analysis temporarily unavailable',
    retry: true,
    user_action: 'Our analysis service is temporarily unavailable. Please try again in a few minutes'
  },
  'ANALYSIS_FAILED': {
    code: 500,
    message: 'Trade analysis could not be completed',
    retry: true,
    user_action: 'Please try uploading your screenshots again'
  },
  'SERVER_TIMEOUT': {
    code: 504,
    message: 'Server response timeout during analysis',
    retry: true,
    user_action: 'The analysis is taking longer than expected. Please retry'
  },

  // Storage errors
  'STORAGE_FULL': {
    code: 507,
    message: 'Storage temporarily unavailable',
    retry: true,
    user_action: 'Our storage is temporarily full. Please try again shortly'
  },
  'UPLOAD_FAILED': {
    code: 500,
    message: 'Upload failed. Please try again',
    retry: true,
    user_action: 'Something went wrong with the upload. Please try again'
  },
  'FILE_SAVE_ERROR': {
    code: 500,
    message: 'Failed to save uploaded file',
    retry: true,
    user_action: 'File could not be saved. Please try uploading again'
  },

  // Database errors
  'DATABASE_ERROR': {
    code: 500,
    message: 'Database operation failed',
    retry: true,
    user_action: 'A database error occurred. Please try again'
  },
  'TRADE_NOT_FOUND': {
    code: 404,
    message: 'Trade record not found',
    retry: false,
    user_action: 'The requested trade could not be found'
  },
  'DUPLICATE_TRADE': {
    code: 409,
    message: 'Trade with this ID already exists',
    retry: false,
    user_action: 'This trade has already been analyzed'
  },

  // Validation errors
  'INVALID_TIMEFRAME_LABEL': {
    code: 400,
    message: 'Invalid timeframe label format',
    retry: false,
    user_action: 'Please use valid timeframe labels (e.g., 1min, 5min, 15min)'
  },
  'INVALID_TRADING_CONTEXT': {
    code: 400,
    message: 'Invalid trading context format',
    retry: false,
    user_action: 'Please check your trading context data format'
  },
  'MISSING_REQUIRED_TIMEFRAME': {
    code: 400,
    message: '1-minute chart is required for analysis',
    retry: false,
    user_action: 'Please include a 1-minute timeframe chart in your upload'
  },

  // Authentication/Authorization errors
  'UNAUTHORIZED': {
    code: 401,
    message: 'Authentication required',
    retry: false,
    user_action: 'Please log in to continue'
  },
  'FORBIDDEN': {
    code: 403,
    message: 'Access denied',
    retry: false,
    user_action: 'You do not have permission to access this resource'
  },

  // Rate limiting errors
  'RATE_LIMIT_EXCEEDED': {
    code: 429,
    message: 'Too many requests. Please wait before trying again',
    retry: true,
    user_action: 'You\'ve made too many requests. Please wait a few minutes before trying again'
  },
  'DAILY_LIMIT_EXCEEDED': {
    code: 429,
    message: 'Daily analysis limit reached',
    retry: false,
    user_action: 'You\'ve reached your daily limit for trade analysis. Try again tomorrow'
  },

  // Settings errors
  'INVALID_SETTINGS_FORMAT': {
    code: 400,
    message: 'Settings object is required',
    retry: false,
    user_action: 'Please provide valid settings data'
  },
  'INVALID_RISK_AMOUNT': {
    code: 400,
    message: 'Max risk per trade must be between $1 and $500',
    retry: false,
    user_action: 'Please set your risk amount between $1 and $500'
  },
  'INVALID_ACCOUNT_SIZE': {
    code: 400,
    message: 'Account size must be at least $1,000',
    retry: false,
    user_action: 'Please enter an account size of at least $1,000'
  },
  'INVALID_WEEKLY_TARGET': {
    code: 400,
    message: 'Weekly target must be between 0.1% and 10%',
    retry: false,
    user_action: 'Please set a weekly target between 0.1% and 10%'
  }
};

/**
 * Create a standardized error response
 * @param {string} errorCode - Error code from ERROR_CODES
 * @param {object} additionalData - Additional error context
 * @returns {object} Formatted error response
 */
const createErrorResponse = (errorCode, additionalData = {}) => {
  const errorInfo = ERROR_CODES[errorCode] || {
    code: 500,
    message: 'An unexpected error occurred',
    retry: true,
    user_action: 'Please try again or contact support if the problem persists'
  };

  return {
    success: false,
    error: errorCode,
    message: errorInfo.message,
    code: errorInfo.code,
    retry_allowed: errorInfo.retry,
    user_action: errorInfo.user_action,
    timestamp: new Date().toISOString(),
    ...additionalData
  };
};

/**
 * Retry logic implementation with exponential backoff
 * @param {Function} operation - Operation to retry
 * @param {string} errorCode - Error code for context
 * @param {number} attempt - Current attempt number
 * @param {number} maxAttempts - Maximum retry attempts
 * @returns {Promise} Operation result or final error
 */
const handleRetryableError = async (operation, errorCode, attempt = 1, maxAttempts = 3) => {
  const errorInfo = ERROR_CODES[errorCode];

  if (!errorInfo?.retry || attempt >= maxAttempts) {
    throw createErrorResponse(errorCode, {
      attempt: attempt,
      max_attempts: maxAttempts,
      final_attempt: true
    });
  }

  // Exponential backoff: 1s, 2s, 4s, up to max 10s
  const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);

  await new Promise(resolve => setTimeout(resolve, delay));

  try {
    return await operation();
  } catch (error) {
    console.warn(`Retry attempt ${attempt} failed for ${errorCode}:`, error);
    return handleRetryableError(operation, errorCode, attempt + 1, maxAttempts);
  }
};

/**
 * Validate file upload and return appropriate error
 * @param {object} file - Uploaded file object
 * @param {object} options - Validation options
 * @returns {object|null} Error response or null if valid
 */
const validateFileUpload = (file, options = {}) => {
  const maxSize = options.maxSize || 10 * 1024 * 1024; // 10MB default
  const allowedTypes = options.allowedTypes || ['image/png', 'image/jpeg', 'image/jpg', 'application/pdf'];

  if (!file) {
    return createErrorResponse('NO_FILES_UPLOADED');
  }

  if (file.size > maxSize) {
    return createErrorResponse('FILE_TOO_LARGE', {
      file_size: file.size,
      max_size: maxSize,
      file_size_mb: (file.size / 1024 / 1024).toFixed(2)
    });
  }

  if (!allowedTypes.includes(file.mimetype)) {
    return createErrorResponse('INVALID_FORMAT', {
      file_type: file.mimetype,
      allowed_types: allowedTypes
    });
  }

  // Check for file corruption indicators
  if (file.size < 1024) { // Files smaller than 1KB are likely corrupted
    return createErrorResponse('CORRUPTED_FILE', {
      file_size: file.size
    });
  }

  return null; // File is valid
};

/**
 * Validate trading context data
 * @param {object} context - Trading context object
 * @returns {object|null} Error response or null if valid
 */
const validateTradingContext = (context) => {
  if (!context || typeof context !== 'object') {
    return createErrorResponse('INVALID_TRADING_CONTEXT');
  }

  // Validate required fields
  const requiredFields = ['instrument', 'trading_style'];
  for (const field of requiredFields) {
    if (!context[field]) {
      return createErrorResponse('INVALID_TRADING_CONTEXT', {
        missing_field: field,
        provided_fields: Object.keys(context)
      });
    }
  }

  // Validate account size if provided
  if (context.account_size && context.account_size < 1000) {
    return createErrorResponse('INVALID_ACCOUNT_SIZE', {
      provided_size: context.account_size
    });
  }

  return null; // Context is valid
};

/**
 * Validate timeframe labels
 * @param {Array} timeframes - Array of timeframe labels
 * @param {object} options - Validation options
 * @returns {object|null} Error response or null if valid
 */
const validateTimeframes = (timeframes, options = {}) => {
  if (!timeframes || !Array.isArray(timeframes) || timeframes.length === 0) {
    return createErrorResponse('NO_FILES_UPLOADED');
  }

  // Check for required timeframes
  if (options.requireMinute && !timeframes.some(tf => tf.includes('1min') || tf.includes('1m'))) {
    return createErrorResponse('MISSING_REQUIRED_TIMEFRAME');
  }

  // Validate timeframe format
  const validTimeframePattern = /^[\w\d_\-\s]+$/;
  for (const timeframe of timeframes) {
    if (!validTimeframePattern.test(timeframe) || timeframe.length > 50) {
      return createErrorResponse('INVALID_TIMEFRAME_LABEL', {
        invalid_timeframe: timeframe,
        max_length: 50
      });
    }
  }

  return null; // Timeframes are valid
};

/**
 * Handle database errors with appropriate responses
 * @param {Error} error - Database error
 * @returns {object} Formatted error response
 */
const handleDatabaseError = (error) => {
  console.error('Database error:', error);

  // Check for specific database error types
  if (error.code === 'SQLITE_BUSY') {
    return createErrorResponse('DATABASE_ERROR', {
      database_error: 'Database is busy, please retry',
      error_code: 'SQLITE_BUSY'
    });
  }

  if (error.code === 'SQLITE_CONSTRAINT') {
    return createErrorResponse('DUPLICATE_TRADE', {
      database_error: 'Constraint violation - possible duplicate',
      error_code: 'SQLITE_CONSTRAINT'
    });
  }

  return createErrorResponse('DATABASE_ERROR', {
    database_error: error.message,
    error_code: error.code || 'UNKNOWN'
  });
};

/**
 * Handle Claude API errors
 * @param {Error} error - Claude API error
 * @returns {object} Formatted error response
 */
const handleClaudeAPIError = (error) => {
  console.error('Claude API error:', error);

  if (error.code === 'TIMEOUT' || error.message?.includes('timeout')) {
    return createErrorResponse('CLAUDE_API_TIMEOUT', {
      api_error: error.message
    });
  }

  if (error.code === 'RATE_LIMIT') {
    return createErrorResponse('RATE_LIMIT_EXCEEDED', {
      api_error: 'Claude API rate limit exceeded',
      retry_after: error.retry_after || 60
    });
  }

  if (error.code === 'SERVER_ERROR' || error.status >= 500) {
    return createErrorResponse('CLAUDE_API_ERROR', {
      api_error: error.message,
      status: error.status
    });
  }

  return createErrorResponse('ANALYSIS_FAILED', {
    api_error: error.message,
    error_code: error.code
  });
};

/**
 * Log errors for monitoring and debugging
 * @param {string} context - Error context (e.g., 'upload', 'analysis')
 * @param {Error} error - Error object
 * @param {object} metadata - Additional metadata
 */
const logError = (context, error, metadata = {}) => {
  const logEntry = {
    timestamp: new Date().toISOString(),
    context: context,
    error_message: error.message,
    error_stack: error.stack,
    error_code: error.code,
    metadata: metadata
  };

  console.error(`[ERROR:${context.toUpperCase()}]`, logEntry);

  // In production, you might want to send this to a logging service
  // await loggingService.error(logEntry);
};

/**
 * Wrap async handlers with comprehensive error handling
 * @param {Function} handler - Async handler function
 * @param {string} context - Error context
 * @returns {Function} Wrapped handler
 */
const withErrorHandling = (handler, context) => {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (error) {
      logError(context, error, {
        path: req.path,
        method: req.method,
        body: req.body,
        query: req.query
      });

      // Determine appropriate error response
      let errorResponse;

      if (error.code && ERROR_CODES[error.code]) {
        errorResponse = createErrorResponse(error.code);
      } else if (error.message?.includes('database')) {
        errorResponse = handleDatabaseError(error);
      } else if (error.message?.includes('Claude') || error.message?.includes('API')) {
        errorResponse = handleClaudeAPIError(error);
      } else {
        errorResponse = createErrorResponse('UPLOAD_FAILED', {
          internal_error: error.message
        });
      }

      res.status(errorResponse.code).json(errorResponse);
    }
  };
};

module.exports = {
  ERROR_CODES,
  createErrorResponse,
  handleRetryableError,
  validateFileUpload,
  validateTradingContext,
  validateTimeframes,
  handleDatabaseError,
  handleClaudeAPIError,
  logError,
  withErrorHandling
};