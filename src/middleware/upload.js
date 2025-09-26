const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const uploadDir = './uploads';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dateDir = new Date().toISOString().split('T')[0];
    const fullPath = path.join(uploadDir, dateDir);

    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
    }

    cb(null, fullPath);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}_${Date.now()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

// Multi-timeframe storage with organized folder structure
const multiTimeframeStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const tradeId = req.body.tradeId || req.params.tradeId || uuidv4();
    const dateDir = new Date().toISOString().split('T')[0];
    const fullPath = path.join(uploadDir, 'trades', dateDir, tradeId);

    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
    }

    req.tradeId = tradeId; // Ensure tradeId is available in request
    cb(null, fullPath);
  },
  filename: (req, file, cb) => {
    const timeframe = file.fieldname; // '1min', '5min', '15min', 'daily'
    const timestamp = Date.now();
    const uniqueName = `${timeframe}_${timestamp}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'application/pdf'];

  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only PNG, JPEG, and PDF files are allowed.'), false);
  }
};

const upload = multer({
  storage: storage,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024,
    files: 1
  },
  fileFilter: fileFilter
});

// Multi-timeframe upload configuration (legacy support)
const multiTimeframeUpload = multer({
  storage: multiTimeframeStorage,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024,
    files: 4, // Maximum 4 timeframes
    fields: 4 // Allow up to 4 different field names
  },
  fileFilter: fileFilter
});

// Universal timeframe upload (flexible field names)
const universalTimeframeUpload = multer({
  storage: multiTimeframeStorage,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024,
    files: 10, // Support up to 10 different timeframes
    fields: 10 // Allow up to 10 different field names
  },
  fileFilter: fileFilter
});

const validateUploadedFile = (req, res, next) => {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      error: 'No File Uploaded',
      message: 'Please upload a trading screenshot (PNG, JPEG, or PDF)'
    });
  }

  const allowedExtensions = ['.png', '.jpg', '.jpeg', '.pdf'];
  const fileExtension = path.extname(req.file.filename).toLowerCase();

  if (!allowedExtensions.includes(fileExtension)) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({
      success: false,
      error: 'Invalid File Type',
      message: 'Only PNG, JPEG, and PDF files are supported for trading screenshots'
    });
  }

  req.file.relativePath = path.relative('./', req.file.path);
  next();
};

// Multi-timeframe upload validation
const validateMultiTimeframeUpload = (req, res, next) => {
  if (!req.files || Object.keys(req.files).length === 0) {
    return res.status(400).json({
      success: false,
      error: 'No Files Uploaded',
      message: 'Please upload at least one timeframe screenshot (1min required)'
    });
  }

  const allowedTimeframes = ['1min', '5min', '15min', 'daily'];
  const allowedExtensions = ['.png', '.jpg', '.jpeg', '.pdf'];
  const uploadedTimeframes = Object.keys(req.files);

  // Validate that 1min is always included (required)
  if (!uploadedTimeframes.includes('1min')) {
    cleanupMultiTimeframeFiles(req.files);
    return res.status(400).json({
      success: false,
      error: 'Missing Required Timeframe',
      message: '1-minute chart is required for analysis'
    });
  }

  // Validate all uploaded timeframes and file types
  for (const timeframe of uploadedTimeframes) {
    if (!allowedTimeframes.includes(timeframe)) {
      cleanupMultiTimeframeFiles(req.files);
      return res.status(400).json({
        success: false,
        error: 'Invalid Timeframe',
        message: `Invalid timeframe: ${timeframe}. Allowed: ${allowedTimeframes.join(', ')}`
      });
    }

    const file = req.files[timeframe][0]; // Each timeframe has array of files, take first
    const fileExtension = path.extname(file.filename).toLowerCase();

    if (!allowedExtensions.includes(fileExtension)) {
      cleanupMultiTimeframeFiles(req.files);
      return res.status(400).json({
        success: false,
        error: 'Invalid File Type',
        message: `Invalid file type for ${timeframe}. Only PNG, JPEG, and PDF are supported`
      });
    }

    // Add relative path to each file
    file.relativePath = path.relative('./', file.path);
  }

  // Set timeframes list for later use
  req.timeframesUploaded = uploadedTimeframes.sort();
  next();
};

// Frontend-compatible array-based timeframe validation
const validateFrontendTimeframeUpload = (req, res, next) => {
  const { createErrorResponse, validateFileUpload, validateTimeframes } = require('../services/errorHandler');

  // Check if files were uploaded
  if (!req.files || Object.keys(req.files).length === 0) {
    return res.status(400).json(createErrorResponse('NO_FILES_UPLOADED'));
  }

  const uploadedTimeframes = Object.keys(req.files);

  // Validate timeframes
  const timeframeError = validateTimeframes(uploadedTimeframes);
  if (timeframeError) {
    cleanupMultiTimeframeFiles(req.files);
    return res.status(timeframeError.code).json(timeframeError);
  }

  // Validate all uploaded files
  for (const timeframeLabel of uploadedTimeframes) {
    const file = req.files[timeframeLabel][0]; // Each timeframe has array of files, take first

    // Validate file using comprehensive error handler
    const fileError = validateFileUpload(file, {
      maxSize: 10 * 1024 * 1024, // 10MB
      allowedTypes: ['image/png', 'image/jpeg', 'image/jpg', 'application/pdf']
    });

    if (fileError) {
      cleanupMultiTimeframeFiles(req.files);
      return res.status(fileError.code).json({
        ...fileError,
        timeframe: timeframeLabel
      });
    }

    // Add relative path to each file
    file.relativePath = path.relative('./', file.path);
  }

  // Set timeframes list for later use
  req.timeframesUploaded = uploadedTimeframes.sort();

  // Parse trading context (can come from form data or JSON)
  let tradingContext;
  try {
    if (req.body.trading_context) {
      tradingContext = typeof req.body.trading_context === 'string'
        ? JSON.parse(req.body.trading_context)
        : req.body.trading_context;
    } else {
      // Fallback to individual fields
      tradingContext = {
        instrument: req.body.instrument || 'MNQ',
        trading_style: req.body.trading_style || 'scalping',
        session_info: req.body.session_info || getCurrentSessionTime(),
        account_size: parseFloat(req.body.account_size) || 67500
      };
    }
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: 'INVALID_TRADING_CONTEXT',
      message: 'Invalid trading context format',
      code: 400
    });
  }

  // Determine primary timeframe from files or context
  let primaryTimeframe = uploadedTimeframes[0]; // default to first

  // Check if any file was marked as primary in the request
  for (const timeframe of uploadedTimeframes) {
    if (req.body[`${timeframe}_is_primary`] === 'true') {
      primaryTimeframe = timeframe;
      break;
    }
  }

  req.tradingContext = {
    ...tradingContext,
    primary_timeframe: primaryTimeframe
  };

  // Build screenshot metadata for frontend compatibility
  req.screenshotMetadata = uploadedTimeframes.map(timeframe => ({
    timeframe_label: timeframe,
    is_primary: timeframe === primaryTimeframe,
    file_path: req.files[timeframe][0].relativePath,
    file_size: req.files[timeframe][0].size
  }));

  next();
};

// Legacy validation for backward compatibility
const validateUniversalTimeframeUpload = (req, res, next) => {
  if (!req.files || Object.keys(req.files).length === 0) {
    return res.status(400).json({
      success: false,
      error: 'No Files Uploaded',
      message: 'Please upload at least one timeframe screenshot'
    });
  }

  const allowedExtensions = ['.png', '.jpg', '.jpeg', '.pdf'];
  const uploadedTimeframes = Object.keys(req.files);

  // Validate all uploaded files
  for (const timeframeLabel of uploadedTimeframes) {
    // Validate timeframe label format (allow any reasonable format)
    if (!/^[a-zA-Z0-9_\-]+$/.test(timeframeLabel) || timeframeLabel.length > 20) {
      cleanupMultiTimeframeFiles(req.files);
      return res.status(400).json({
        success: false,
        error: 'Invalid Timeframe Label',
        message: `Invalid timeframe label: "${timeframeLabel}". Use alphanumeric characters, underscores, or hyphens only (max 20 chars)`
      });
    }

    const file = req.files[timeframeLabel][0]; // Each timeframe has array of files, take first
    const fileExtension = path.extname(file.filename).toLowerCase();

    if (!allowedExtensions.includes(fileExtension)) {
      cleanupMultiTimeframeFiles(req.files);
      return res.status(400).json({
        success: false,
        error: 'Invalid File Type',
        message: `Invalid file type for timeframe "${timeframeLabel}". Only PNG, JPEG, and PDF are supported`
      });
    }

    // Add relative path to each file
    file.relativePath = path.relative('./', file.path);
  }

  // Set timeframes list for later use
  req.timeframesUploaded = uploadedTimeframes.sort();

  // Add trading context from request body
  req.tradingContext = {
    instrument: req.body.instrument || 'MNQ',
    trading_style: req.body.trading_style || 'mnq_scalping',
    session_info: req.body.session_info || req.body.session_time || getCurrentSessionTime(),
    account_size: req.body.account_size || process.env.DEFAULT_ACCOUNT_SIZE || 67500,
    primary_timeframe: req.body.primary_timeframe || uploadedTimeframes[0] // Default to first uploaded
  };

  next();
};

// Helper function to get current session time
const getCurrentSessionTime = () => {
  const now = new Date();
  const easternTime = new Date(now.toLocaleString("en-US", {timeZone: "America/New_York"}));
  return easternTime.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
};

const cleanupFile = (filePath) => {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`🗑️ Cleaned up file: ${filePath}`);
    }
  } catch (error) {
    console.error(`Failed to cleanup file ${filePath}:`, error.message);
  }
};

// Cleanup multiple timeframe files
const cleanupMultiTimeframeFiles = (files) => {
  try {
    for (const timeframe in files) {
      if (files[timeframe] && Array.isArray(files[timeframe])) {
        files[timeframe].forEach(file => {
          if (file.path && fs.existsSync(file.path)) {
            fs.unlinkSync(file.path);
            console.log(`🗑️ Cleaned up ${timeframe} file: ${file.path}`);
          }
        });
      }
    }
  } catch (error) {
    console.error('Failed to cleanup multi-timeframe files:', error.message);
  }
};

const getFileStats = (filePath) => {
  try {
    const stats = fs.statSync(filePath);
    return {
      size: stats.size,
      created: stats.birthtime,
      modified: stats.mtime,
      sizeReadable: formatFileSize(stats.size)
    };
  } catch (error) {
    return null;
  }
};

const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

module.exports = {
  upload,
  multiTimeframeUpload,
  universalTimeframeUpload,
  validateUploadedFile,
  validateMultiTimeframeUpload,
  validateUniversalTimeframeUpload,
  validateFrontendTimeframeUpload,
  cleanupFile,
  cleanupMultiTimeframeFiles,
  getFileStats
};