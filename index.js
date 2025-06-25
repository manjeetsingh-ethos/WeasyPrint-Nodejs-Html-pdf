const express = require('express');
const { Piscina } = require('piscina');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Production configuration
const POOL_MIN_THREADS = parseInt(process.env.POOL_MIN_THREADS) || 2;
const POOL_MAX_THREADS = parseInt(process.env.POOL_MAX_THREADS) || 4;
const REQUEST_TIMEOUT = parseInt(process.env.REQUEST_TIMEOUT) || 30000; // 30 seconds

// Production logging
const log = {
    info: (msg, ...args) => console.log(`[INFO] ${new Date().toISOString()} ${msg}`, ...args),
    error: (msg, ...args) => console.error(`[ERROR] ${new Date().toISOString()} ${msg}`, ...args),
    warn: (msg, ...args) => console.warn(`[WARN] ${new Date().toISOString()} ${msg}`, ...args)
};

// Initialize Piscina worker pool
let pool = null;

try {
    pool = new Piscina({
        filename: path.resolve(__dirname, 'pdf_worker.js'),
        minThreads: POOL_MIN_THREADS,
        maxThreads: POOL_MAX_THREADS,
        idleTimeout: 60000, // Keep workers alive for 1 minute
        maxQueue: 'auto', // Auto-calculate queue size
        recordTiming: true // Track performance metrics
    });
    
    log.info(`PDF worker pool initialized: ${POOL_MIN_THREADS}-${POOL_MAX_THREADS} threads`);
} catch (error) {
    log.error('Failed to initialize worker pool:', error);
    process.exit(1);
}

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' })); // Reasonable limit for production

// Request timeout middleware
app.use((req, res, next) => {
    req.setTimeout(REQUEST_TIMEOUT, () => {
        log.warn(`Request timeout for ${req.method} ${req.path}`);
        if (!res.headersSent) {
            res.status(408).json({ 
                error: 'Request timeout',
                message: 'Request took too long to process'
            });
        }
    });
    next();
});

// Request logging middleware
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        log.info(`${req.method} ${req.path} - ${res.statusCode} - ${duration}ms`);
    });
    next();
});

// Health check endpoint
app.get('/health', (req, res) => {
    const stats = pool ? {
        threads: pool.threads.length,
        completed: pool.completed,
        duration: pool.duration,
        queue: pool.queueSize
    } : null;
    
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        pool: stats
    });
});

// Main PDF generation endpoint
app.get('/pdf', async (req, res) => {
    const startTime = Date.now();
    
    try {
        // Get HTML from query parameter or use template
        let htmlContent;
        
        if (req.query.html) {
            htmlContent = decodeURIComponent(req.query.html);
        } else {
            // Fallback to template
            const templatePath = path.join(__dirname, 'template.html');
            if (!fs.existsSync(templatePath)) {
                log.error('Template file not found:', templatePath);
                return res.status(500).json({
                    error: 'Server configuration error',
                    message: 'PDF template not available and no HTML provided'
                });
            }
            htmlContent = fs.readFileSync(templatePath, 'utf8');
        }
        
        // Generate PDF using worker pool
        log.info('Generating PDF...');
        const pdfResult = await pool.run({
            html: htmlContent,
            css: null,
            options: {}
        });

        // Convert result back to Buffer if it was serialized
        const pdfBuffer = Buffer.isBuffer(pdfResult) ? pdfResult : Buffer.from(Object.values(pdfResult));

        const processingTime = Date.now() - startTime;
        log.info(`PDF generated successfully in ${processingTime}ms, size: ${pdfBuffer.length} bytes`);

        // Set response headers
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="document.pdf"');
        res.setHeader('Content-Length', pdfBuffer.length);
        res.setHeader('X-Processing-Time', processingTime);

        // Send PDF
        res.send(pdfBuffer);

    } catch (error) {
        const processingTime = Date.now() - startTime;
        log.error(`PDF generation failed after ${processingTime}ms:`, error.message);

        // Don't expose internal errors in production
        if (!res.headersSent) {
            res.status(500).json({
                error: 'PDF generation failed',
                message: 'Unable to generate PDF document',
                timestamp: new Date().toISOString()
            });
        }
    }
});

// Global error handler
app.use((error, req, res, next) => {
    log.error('Unhandled error:', error);
    
    if (!res.headersSent) {
        res.status(500).json({
            error: 'Internal server error',
            message: 'An unexpected error occurred',
            timestamp: new Date().toISOString()
        });
    }
});

// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({
        error: 'Not found',
        message: `Route ${req.method} ${req.originalUrl} not found`,
        availableRoutes: [
            'GET /health - Health check',
            'GET /pdf - Generate PDF from template'
        ]
    });
});

// Graceful shutdown
const gracefulShutdown = async (signal) => {
    log.info(`Received ${signal}, shutting down gracefully...`);
    
    // Stop accepting new requests
    const server = app.listen(PORT);
    server.close(async () => {
        log.info('HTTP server closed');
        
        // Shutdown worker pool
        if (pool) {
            try {
                await pool.destroy();
                log.info('Worker pool destroyed');
            } catch (error) {
                log.error('Error destroying worker pool:', error);
            }
        }
        
        log.info('Graceful shutdown complete');
        process.exit(0);
    });
    
    // Force shutdown after 10 seconds
    setTimeout(() => {
        log.error('Force shutdown - graceful shutdown timed out');
        process.exit(1);
    }, 10000);
};

// Handle shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    log.error('Uncaught exception:', error);
    gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
    log.error('Unhandled rejection at:', promise, 'reason:', reason);
    gracefulShutdown('unhandledRejection');
});

// Start server
app.listen(PORT, () => {
    log.info(`Production PDF service started on port ${PORT}`);
    log.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
    log.info(`Worker pool: ${POOL_MIN_THREADS}-${POOL_MAX_THREADS} threads`);
    log.info(`Request timeout: ${REQUEST_TIMEOUT}ms`);
    log.info('Available endpoints:');
    log.info('  GET /health - Health check and metrics');
    log.info('  GET /pdf - Generate PDF from template');
});

module.exports = app; 