const express = require('express');
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 4000;

app.enable("trust proxy");
app.set("json spaces", 2);

// Enhanced middleware configuration
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*',
  credentials: true
}));

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Request logging middleware
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(chalk.cyan(`[${timestamp}] ${req.method} ${req.url} - ${req.ip}`));
  next();
});

// Serve static files from the "web" folder with caching
app.use('/', express.static(path.join(__dirname, 'web'), {
  maxAge: process.env.NODE_ENV === 'production' ? '1d' : '0'
}));

// Expose settings.json at the root
app.get('/settings.json', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, 'settings.json'));
});

// Load settings for middleware with error handling
let settings = {};
try {
  const settingsPath = path.join(__dirname, 'settings.json');
  if (fs.existsSync(settingsPath)) {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
  } else {
    console.warn(chalk.yellow('⚠️  settings.json not found, using defaults'));
    settings = { apiSettings: { operator: "Ladybug APIs" } };
  }
} catch (error) {
  console.error(chalk.red('❌ Error loading settings.json:', error.message));
  settings = { apiSettings: { operator: "Ladybug APIs" } };
}

// Enhanced middleware to augment JSON responses
app.use((req, res, next) => {
  const originalJson = res.json;
  res.json = function (data) {
    if (data && typeof data === 'object') {
      const responseData = {
        status: data.status || 'success',
        operator: (settings.apiSettings && settings.apiSettings.operator) || "Ladybug APIs",
        timestamp: new Date().toISOString(),
        version: settings.version || '1.0.0',
        ...data
      };
      return originalJson.call(this, responseData);
    }
    return originalJson.call(this, data);
  };
  next();
});

// Load API modules from the "api" folder and its subfolders recursively
const apiFolder = path.join(__dirname, 'api');
let totalRoutes = 0;
const apiModules = [];
const loadErrors = [];

// Enhanced recursive function to load modules
const loadModules = (dir) => {
  if (!fs.existsSync(dir)) {
    console.warn(chalk.yellow(`⚠️  API directory not found: ${dir}`));
    return;
  }

  fs.readdirSync(dir).forEach((file) => {
    const filePath = path.join(dir, file);
    const stats = fs.statSync(filePath);
    
    if (stats.isDirectory()) {
      loadModules(filePath); // Recurse into subfolder
    } else if (stats.isFile() && path.extname(file) === '.js') {
      try {
        // Clear require cache in development
        if (process.env.NODE_ENV !== 'production') {
          delete require.cache[require.resolve(filePath)];
        }
        
        const module = require(filePath);
        
        // Enhanced module validation
        if (!module.meta || typeof module.meta !== 'object') {
          throw new Error('Missing or invalid meta object');
        }
        
        if (!module.onStart || typeof module.onStart !== 'function') {
          throw new Error('Missing or invalid onStart function');
        }

        if (!module.meta.path || !module.meta.name) {
          throw new Error('Missing required meta.path or meta.name');
        }

        const basePath = module.meta.path.split('?')[0];
        const routePath = '/api' + basePath;
        const method = (module.meta.method || 'get').toLowerCase();
        
        // Validate HTTP method
        const validMethods = ['get', 'post', 'put', 'delete', 'patch', 'head', 'options'];
        if (!validMethods.includes(method)) {
          throw new Error(`Invalid HTTP method: ${method}`);
        }

        // Register route with error handling
        app[method](routePath, async (req, res) => {
          const startTime = Date.now();
          console.log(chalk.bgHex('#99FF99').hex('#333').bold(`🚀 ${method.toUpperCase()} ${routePath}`));
          
          try {
            // Add timeout for long-running requests
            const timeout = setTimeout(() => {
              if (!res.headersSent) {
                res.status(408).json({
                  status: 'error',
                  message: 'Request timeout',
                  code: 'TIMEOUT'
                });
              }
            }, 30000); // 30 second timeout

            await module.onStart({ req, res });
            clearTimeout(timeout);
            
            const duration = Date.now() - startTime;
            console.log(chalk.green(`✅ Completed in ${duration}ms`));
          } catch (error) {
            console.error(chalk.red(`❌ Error in ${module.meta.name}:`, error.message));
            if (!res.headersSent) {
              res.status(500).json({
                status: 'error',
                message: 'Internal server error',
                code: 'INTERNAL_ERROR'
              });
            }
          }
        });

        // Store enhanced module metadata
        apiModules.push({
          name: module.meta.name,
          description: module.meta.description || 'No description provided',
          category: module.meta.category || 'Uncategorized',
          path: routePath + (module.meta.path.includes('?') ? '?' + module.meta.path.split('?')[1] : ''),
          author: module.meta.author || 'Unknown',
          method: module.meta.method || 'GET',
          version: module.meta.version || '1.0.0',
          tags: module.meta.tags || [],
          deprecated: module.meta.deprecated || false,
          rateLimit: module.meta.rateLimit || null
        });

        totalRoutes++;
        console.log(chalk.bgHex('#FFFF99').hex('#333').bold(`📁 Loaded: ${module.meta.name} [${method.toUpperCase()}]`));
        
      } catch (error) {
        const errorInfo = {
          file: filePath,
          error: error.message,
          timestamp: new Date().toISOString()
        };
        loadErrors.push(errorInfo);
        console.error(chalk.bgHex('#FF9999').hex('#333').bold(`❌ Failed to load ${filePath}: ${error.message}`));
      }
    }
  });
};

// Load modules with startup banner
console.log(chalk.bgHex('#4A90E2').hex('#FFF').bold('🐞 Ladybug APIs Starting...'));
loadModules(apiFolder);

// Startup summary
console.log(chalk.bgHex('#90EE90').hex('#333').bold('✅ Module Loading Complete!'));
console.log(chalk.bgHex('#90EE90').hex('#333').bold(`📊 Total Routes: ${totalRoutes}`));
if (loadErrors.length > 0) {
  console.log(chalk.bgHex('#FFA500').hex('#333').bold(`⚠️  Load Errors: ${loadErrors.length}`));
}

// Enhanced API info endpoint
app.get('/api/info', (req, res) => {
  const categories = {};
  let totalEndpoints = 0;
  
  apiModules.forEach(module => {
    if (!categories[module.category]) {
      categories[module.category] = { 
        name: module.category, 
        count: 0,
        items: [] 
      };
    }
    
    categories[module.category].items.push({
      name: module.name,
      desc: module.description,
      path: module.path,
      author: module.author,
      method: module.method,
      version: module.version,
      tags: module.tags,
      deprecated: module.deprecated,
      rateLimit: module.rateLimit
    });
    
    categories[module.category].count++;
    totalEndpoints++;
  });

  res.json({ 
    categories: Object.values(categories),
    summary: {
      totalEndpoints,
      totalCategories: Object.keys(categories).length,
      loadErrors: loadErrors.length,
      serverUptime: process.uptime()
    }
  });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    timestamp: new Date().toISOString(),
    version: settings.version || '1.0.0'
  });
});

// API statistics endpoint
app.get('/api/stats', (req, res) => {
  res.json({
    totalRoutes,
    loadErrors: loadErrors.length,
    categories: [...new Set(apiModules.map(m => m.category))].length,
    methods: apiModules.reduce((acc, module) => {
      acc[module.method] = (acc[module.method] || 0) + 1;
      return acc;
    }, {}),
    uptime: process.uptime(),
    nodeVersion: process.version
  });
});

// Enhanced root routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'web', 'portal.html'));
});

app.get('/docs', (req, res) => {
  res.sendFile(path.join(__dirname, 'web', 'docs.html'));
});

// API playground route
app.get('/playground', (req, res) => {
  res.sendFile(path.join(__dirname, 'web', 'playground.html'));
});

// Enhanced 404 error handler
app.use((req, res) => {
  console.log(chalk.yellow(`⚠️  404 Not Found: ${req.method} ${req.url} - ${req.ip}`));
  
  // Check if it's an API request
  if (req.url.startsWith('/api/')) {
    res.status(404).json({
      status: 'error',
      message: 'API endpoint not found',
      code: 'NOT_FOUND',
      suggestion: 'Visit /api/info for available endpoints'
    });
  } else {
    res.status(404).sendFile(path.join(__dirname, 'web', '404.html'));
  }
});

// Enhanced 500 error handler
app.use((err, req, res, next) => {
  console.error(chalk.red('❌ Server Error:'), err.stack);
  
  if (req.url.startsWith('/api/')) {
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  } else {
    res.status(500).sendFile(path.join(__dirname, 'web', '500.html'));
  }
});

// Graceful shutdown handling
process.on('SIGTERM', () => {
  console.log(chalk.yellow('🛑 SIGTERM received, shutting down gracefully...'));
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log(chalk.yellow('🛑 SIGINT received, shutting down gracefully...'));
  process.exit(0);
});

// Start the server
app.listen(PORT, () => {
  console.log(chalk.bgHex('#90EE90').hex('#333').bold(`🌟 Ladybug APIs running on port ${PORT}`));
  console.log(chalk.bgHex('#87CEEB').hex('#333').bold(`📚 Documentation: http://localhost:${PORT}/docs`));
  console.log(chalk.bgHex('#87CEEB').hex('#333').bold(`🔍 API Info: http://localhost:${PORT}/api/info`));
  console.log(chalk.bgHex('#87CEEB').hex('#333').bold(`❤️  Health Check: http://localhost:${PORT}/api/health`));
});

module.exports = app;
