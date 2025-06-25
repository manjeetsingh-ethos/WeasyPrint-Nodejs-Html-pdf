#!/usr/bin/env python3
"""
Optimized WeasyPrint bridge for Node.js
Pre-imports WeasyPrint and caches font configuration for faster generation.
"""

import sys
import json
import traceback
from io import BytesIO

# Pre-import WeasyPrint components for faster execution
from weasyprint import HTML, CSS
from weasyprint.text.fonts import FontConfiguration

# Global font configuration (cached)
FONT_CONFIG = FontConfiguration()

def generate_pdf_fast(html_content, css_content=None):
    """
    Fast PDF generation using pre-loaded WeasyPrint and cached font config
    
    Args:
        html_content (str): HTML content to convert
        css_content (str): Optional CSS content
    
    Returns:
        bytes: PDF content as bytes
    """
    try:
        # Create HTML object
        html_doc = HTML(string=html_content, base_url=".")
        
        # Prepare stylesheets using cached font config
        stylesheets = []
        if css_content:
            stylesheets.append(CSS(string=css_content, font_config=FONT_CONFIG))
        
        # Generate PDF in memory with minimal options for speed
        pdf_buffer = BytesIO()
        html_doc.write_pdf(
            pdf_buffer,
            stylesheets=stylesheets,
            font_config=FONT_CONFIG,
            optimize_images=False  # Disable image optimization for speed
        )
        
        return pdf_buffer.getvalue()
        
    except Exception as e:
        raise Exception(f"PDF generation failed: {str(e)}")


def main():
    """
    Main function - persistent mode for better performance
    """
    # Signal readiness
    sys.stderr.write("WeasyPrint bridge ready\n")
    sys.stderr.flush()
    
    # Process requests in a loop for persistent mode
    while True:
        try:
            # Read input line from stdin
            line = sys.stdin.readline()
            if not line:
                break
                
            # Parse JSON input
            input_data = json.loads(line.strip())
            
            # Extract parameters
            html_content = input_data.get('html', '')
            css_content = input_data.get('css', None)
            
            if not html_content:
                raise ValueError("HTML content is required")
            
            # Generate PDF using optimized function
            pdf_bytes = generate_pdf_fast(html_content, css_content)
            
            # Write PDF buffer directly to stdout
            sys.stdout.buffer.write(pdf_bytes)
            sys.stdout.flush()
            
        except json.JSONDecodeError:
            # Skip invalid JSON, continue processing
            continue
        except Exception as e:
            # Write error to stderr and exit
            error_response = {
                'success': False,
                'error': str(e),
                'traceback': traceback.format_exc()
            }
            sys.stderr.write(json.dumps(error_response) + '\n')
            sys.stderr.flush()
            break


if __name__ == '__main__':
    main() 