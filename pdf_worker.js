const { spawn } = require('child_process');
const path = require('path');

/**
 * Simple PDF worker with basic process reuse
 * This keeps the process pooling concept but makes it much simpler
 */

// Simple process cache (not complex pooling)
let cachedProcess = null;
let processReady = false;
let requestQueue = [];

/**
 * Create a Python process for WeasyPrint
 */
function createPythonProcess() {
    const pythonPath = '/opt/weasyprint/bin/python';
    const bridgePath = path.join(__dirname, 'weasyprint_bridge_optimized.py');
    
    const pythonProcess = spawn(pythonPath, [bridgePath], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONUNBUFFERED: '1' }
    });
    
    // Mark as ready after a short delay (WeasyPrint startup)
    setTimeout(() => {
        processReady = true;
        console.log('WeasyPrint process ready');
    }, 2000);
    
    pythonProcess.on('error', (error) => {
        console.error('Python process error:', error);
        cachedProcess = null;
        processReady = false;
    });
    
    pythonProcess.on('exit', (code) => {
        console.log('Python process exited with code:', code);
        cachedProcess = null;
        processReady = false;
    });
    
    return pythonProcess;
}

/**
 * Get or create Python process
 */
function getProcess() {
    if (!cachedProcess || cachedProcess.killed) {
        console.log('Creating new WeasyPrint process...');
        cachedProcess = createPythonProcess();
        processReady = false;
    }
    return cachedProcess;
}

/**
 * Generate PDF using the cached process
 */
async function generatePDF(data) {
    const process = getProcess();
    
    // Wait for process to be ready
    if (!processReady) {
        console.log('Waiting for WeasyPrint to initialize...');
        await new Promise(resolve => setTimeout(resolve, 3000));
    }
    
    return new Promise((resolve, reject) => {
        let pdfData = Buffer.alloc(0);
        let errorData = '';
        let requestSent = false;
        
        const timeout = setTimeout(() => {
            reject(new Error('PDF generation timeout'));
        }, 30000);
        
        // Handle output - PDF data comes on stdout
        const onData = (chunk) => {
            pdfData = Buffer.concat([pdfData, chunk]);
            // Check if we have a complete PDF (starts with %PDF)
            if (pdfData.length > 4 && pdfData.toString('ascii', 0, 4) === '%PDF') {
                // We got PDF data, resolve immediately
                clearTimeout(timeout);
                process.stdout.removeListener('data', onData);
                process.stderr.removeListener('data', onError);
                resolve(pdfData);
            }
        };
        
        // Handle errors - error messages come on stderr
        const onError = (chunk) => {
            const text = chunk.toString();
            if (text.includes('WeasyPrint bridge ready') && !requestSent) {
                // Bridge is ready, send request
                requestSent = true;
                try {
                    process.stdin.write(JSON.stringify(data) + '\n');
                } catch (error) {
                    clearTimeout(timeout);
                    reject(error);
                }
            } else if (text.trim() && !text.includes('WeasyPrint bridge ready')) {
                errorData += text;
                // If we get an error, reject immediately
                clearTimeout(timeout);
                process.stdout.removeListener('data', onData);
                process.stderr.removeListener('data', onError);
                reject(new Error(`PDF generation failed: ${errorData}`));
            }
        };
        
        // Attach listeners
        process.stdout.on('data', onData);
        process.stderr.on('data', onError);
        
        // Send request if process is already ready
        if (processReady && !requestSent) {
            try {
                requestSent = true;
                process.stdin.write(JSON.stringify(data) + '\n');
            } catch (error) {
                clearTimeout(timeout);
                reject(error);
            }
        }
    });
}

/**
 * Fallback: create one-time process if cached process fails
 */
async function generatePDFFallback(data) {
    console.log('Using fallback one-time process...');
    
    const pythonPath = '/opt/weasyprint/bin/python';
    const bridgePath = path.join(__dirname, 'weasyprint_bridge_optimized.py');
    
    return new Promise((resolve, reject) => {
        const pythonProcess = spawn(pythonPath, [bridgePath], {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env, PYTHONUNBUFFERED: '1' }
        });
        
        let pdfData = Buffer.alloc(0);
        let errorData = '';
        let bridgeReady = false;
        
        pythonProcess.stdout.on('data', (chunk) => {
            pdfData = Buffer.concat([pdfData, chunk]);
        });
        
        pythonProcess.stderr.on('data', (chunk) => {
            const text = chunk.toString();
            if (text.includes('WeasyPrint bridge ready')) {
                bridgeReady = true;
                // Send request now that bridge is ready
                try {
                    pythonProcess.stdin.write(JSON.stringify(data) + '\n');
                } catch (error) {
                    reject(error);
                }
            } else {
                errorData += text;
            }
        });
        
        pythonProcess.on('close', (code) => {
            if (code !== 0 || errorData) {
                reject(new Error(`PDF generation failed: ${errorData || 'Unknown error'}`));
            } else {
                resolve(pdfData);
            }
        });
        
        pythonProcess.on('error', reject);
        
        // Timeout
        setTimeout(() => {
            if (!pythonProcess.killed) {
                pythonProcess.kill();
                reject(new Error('PDF generation timeout'));
            }
        }, 30000);
    });
}

/**
 * Main worker function for Piscina
 */
module.exports = async function(data) {
    const { html, css, options } = data;
    
    if (!html) {
        throw new Error('HTML content is required');
    }
    
    try {
        // Try cached process first (for speed)
        return await generatePDF({ html, css, options });
    } catch (error) {
        console.warn('Cached process failed, using fallback:', error.message);
        
        try {
            // Fallback to one-time process
            return await generatePDFFallback({ html, css, options });
        } catch (fallbackError) {
            throw new Error(`PDF generation failed: ${fallbackError.message}`);
        }
    }
};

// Cleanup on exit
process.on('exit', () => {
    if (cachedProcess && !cachedProcess.killed) {
        cachedProcess.kill();
    }
});

process.on('SIGTERM', () => {
    if (cachedProcess && !cachedProcess.killed) {
        cachedProcess.kill();
    }
    process.exit(0);
}); 