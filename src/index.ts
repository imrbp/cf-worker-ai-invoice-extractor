// src/index.ts
export interface Env {
  AI: any;
}

interface InvoiceData {
  vendor_name: string;
  vendor_address: string;
  invoice_number: string;
  invoice_date: string;
  due_date: string;
  subtotal: string;
  tax: string;
  total: string;
  line_items: Array<{
    description: string;
    quantity: string;
    unit_price: string;
    amount: string;
  }>;
  payment_terms: string;
  notes: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Only accept POST requests
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    try {
      // Get binary image from request
      const imageBuffer = await request.arrayBuffer();
      const imageArray = Array.from(new Uint8Array(imageBuffer));

      // Prepare prompt for structured extraction
      const prompt = `Extract all invoice information from this image and return it as valid JSON with this exact structure:
{
  "vendor_name": "",
  "vendor_address": "",
  "invoice_number": "",
  "invoice_date": "",
  "due_date": "",
  "subtotal": "",
  "tax": "",
  "total": "",
  "line_items": [
    {
      "description": "",
      "quantity": "",
      "unit_price": "",
      "amount": ""
    }
  ],
  "payment_terms": "",
  "notes": ""
}

Only return the JSON, no additional text.`;

      // Call Cloudflare AI
      const response = await env.AI.run('@cf/unum/uform-gen2-qwen-500m', {
        image: imageArray,
        prompt: prompt,
        max_tokens: 1024,
      });

      // Parse the AI response
      let extractedData: InvoiceData;
      
      try {
        // The model might wrap JSON in markdown code blocks
        const text = response.description || response.text || '';
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        
        if (jsonMatch) {
          extractedData = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error('No JSON found in response');
        }
      } catch (parseError) {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'Failed to parse AI response',
            raw_response: response,
          }),
          {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          data: extractedData,
        }),
        {
          headers: { 'Content-Type': 'application/json' },
        }
      );
    } catch (error) {
      return new Response(
        JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
  },
};
