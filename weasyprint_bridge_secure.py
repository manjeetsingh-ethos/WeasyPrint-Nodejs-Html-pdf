#!/usr/bin/env python3
"""
Secure WeasyPrint bridge for Node.js
Uses JSON for input/output communication with request ID verification
"""

import sys
import json
import base64
from io import BytesIO

# Pre-import WeasyPrint components for faster execution
from weasyprint import HTML, CSS
from weasyprint.text.fonts import FontConfiguration

# Global font configuration (cached for performance)
FONT_CONFIG = FontConfiguration()

def generate_pdf_secure(html_content, css_content=None):
    """Generate PDF and return as bytes"""
    try:
        # Create HTML object with isolated context
        html_doc = HTML(string=html_content, base_url=".")
        
        # Prepare stylesheets using cached font config
        stylesheets = []
        if css_content:
            stylesheets.append(CSS(string=css_content, font_config=FONT_CONFIG))
        
        # Generate PDF in isolated memory buffer
        pdf_buffer = BytesIO()
        html_doc.write_pdf(
            pdf_buffer,
            stylesheets=stylesheets,
            font_config=FONT_CONFIG,
            optimize_images=False
        )
        
        return pdf_buffer.getvalue()
        
    except Exception as e:
        raise Exception(f"PDF generation failed: {str(e)}")


def main():
    """
    Main function - JSON input/output communication
    Input: {"html": "...", "css": "...", "request_id": "..."}
    Output: {"success": true, "request_id": "...", "pdf_base64": "..."}
    """
    try:
        # Signal readiness
        sys.stderr.write("WeasyPrint bridge ready\n")
        sys.stderr.flush()
        
        # Read single request from stdin
        line = sys.stdin.readline()
        if not line:
            sys.exit(1)
        
        # Parse JSON input
        input_data = json.loads(line.strip())
        
        # Extract parameters
        html_content = input_data.get('html', '')
        css_content = input_data.get('css', None)
        request_id = input_data.get('request_id', 'unknown')
        
        if not html_content:
            response = {
                'success': False,
                'request_id': request_id,
                'error': 'HTML content is required'
            }
            print(json.dumps(response))
            sys.exit(1)
        
        # Generate PDF
        pdf_bytes = generate_pdf_secure(html_content, css_content)
        
        # Prepare JSON response
        response = {
            'success': True,
            'request_id': request_id,
            'pdf_base64': base64.b64encode(pdf_bytes).decode('utf-8'),
            'size': len(pdf_bytes)
        }
        
        # Send JSON response
        print(json.dumps(response))
        sys.exit(0)
        
    except Exception as e:
        # Error response in JSON format
        response = {
            'success': False,
            'request_id': input_data.get('request_id', 'unknown') if 'input_data' in locals() else 'unknown',
            'error': str(e)
        }
        print(json.dumps(response))
        sys.exit(1)


if __name__ == '__main__':
    main() 