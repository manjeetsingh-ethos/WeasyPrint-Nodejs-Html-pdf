const { spawn } = require('child_process');
const path = require('path');
const crypto = require('crypto');

/**
 * Secure PDF worker with JSON communication
 * Python input: {"html": "...", "css": "...", "request_id": "..."}
 * Python output: {"success": true, "request_id": "...", "pdf_base64": "...", "size": 123}
 */

/**
 * Generate PDF using secure single-request process with request validation
 */
async function generatePDFSecure(data) {
    const requestId = crypto.randomUUID().substring(0, 8);
    const pythonPath = '/opt/weasyprint/bin/python';
    const bridgePath = path.join(__dirname, 'weasyprint_bridge_secure.py');
    
    return new Promise((resolve, reject) => {
        const pythonProcess = spawn(pythonPath, [bridgePath], {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env, PYTHONUNBUFFERED: '1' }
        });
        
        let jsonResponse = '';
        let errorData = '';
        let requestSent = false;
        
        const timeout = setTimeout(() => {
            if (!pythonProcess.killed) {
                pythonProcess.kill();
            }
            reject(new Error(`Request ${requestId} timed out after 40 seconds`));
        }, 40000);
        
        // Collect JSON response from stdout
        pythonProcess.stdout.on('data', (chunk) => {
            jsonResponse += chunk.toString();
        });
        
        pythonProcess.stderr.on('data', (chunk) => {
            const text = chunk.toString();
            
            if (text.includes('WeasyPrint bridge ready') && !requestSent) {
                requestSent = true;
                
                const requestData = {
                    ...data,
                    request_id: requestId
                };
                
                try {
                    pythonProcess.stdin.write(JSON.stringify(requestData) + '\n');
                    pythonProcess.stdin.end();
                } catch (error) {
                    clearTimeout(timeout);
                    reject(new Error(`Failed to send request: ${error.message}`));
                }
            } else if (text.includes('ERROR:')) {
                errorData += text;
            }
        });
        
        pythonProcess.on('close', (code) => {
            clearTimeout(timeout);
            
            if (code !== 0 && !jsonResponse) {
                reject(new Error(`Process failed: ${errorData || 'Unknown error'}`));
                return;
            }
            
            try {
                // Parse JSON response
                const response = JSON.parse(jsonResponse.trim());
                
                // Verify request ID matches
                if (response.request_id !== requestId) {
                    reject(new Error(`Request ID mismatch: expected ${requestId}, got ${response.request_id}`));
                    return;
                }
                
                // Check if successful
                if (!response.success) {
                    reject(new Error(`PDF generation failed: ${response.error}`));
                    return;
                }
                
                // Decode base64 PDF data
                if (!response.pdf_base64) {
                    reject(new Error(`No PDF data in response`));
                    return;
                }
                
                const pdfBuffer = Buffer.from(response.pdf_base64, 'base64');
                
                // Validate PDF data
                if (pdfBuffer.length === 0 || pdfBuffer.toString('ascii', 0, 4) !== '%PDF') {
                    reject(new Error(`Invalid PDF data received`));
                    return;
                }
                
                resolve(pdfBuffer);
                
            } catch (error) {
                reject(new Error(`Failed to parse JSON response: ${error.message}`));
            }
        });
        
        pythonProcess.on('error', (error) => {
            clearTimeout(timeout);
            reject(new Error(`Python process error: ${error.message}`));
        });
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
        return await generatePDFSecure({ html, css, options });
    } catch (error) {
        throw new Error(`PDF generation failed: ${error.message}`);
    }
}; 