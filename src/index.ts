/**
 * Invoice Extraction API
 *
 * Cloudflare Worker that extracts structured data from invoice images
 * using Workers AI vision models.
 *
 * @license MIT
 */
import { Env, InvoiceData, ExtractResponse } from "./types";

// Vision model for invoice extraction
const MODEL_ID = "@cf/llava-hf/llava-1.5-7b-hf";

// Maximum image size (10MB)
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;

// Supported image MIME types
const SUPPORTED_MIME_TYPES = [
	"image/jpeg",
	"image/jpg",
	"image/png",
	"image/webp",
];

// System prompt for invoice extraction
const EXTRACTION_PROMPT = `
You are an information extraction AI.

Your task is to analyze the provided text and extract payment-related information.
The text may come from receipts, invoices, OCR scans, chat messages, or informal notes.
The language may be Indonesian or mixed Indonesian-English.

Extract the following fields and return them in JSON format only.

FIELDS TO EXTRACT:

1. vendor
   - The name of the merchant, seller, store, company, or service provider.
   - Common alternative terms that indicate vendor:
     - "merchant"
     - "toko"
     - "penjual"
     - "store"
     - "company"
     - "nama usaha"
   - If multiple names appear, choose the most relevant one associated with the payment.
   - If no vendor is found, return null.

2. total_idr
   - The total payment amount in Indonesian Rupiah (IDR).
   - Common alternative terms:
     - "nominal pembayaran"
     - "total"
     - "jumlah"
     - "amount"
     - "harga"
     - "bayar"
   - Remove currency symbols (Rp, IDR) and thousand separators.
   - Return the value as a number (integer).
   - If multiple amounts appear, choose the final or total amount paid.
   - If no amount is found, return null.

3. notes
   - Additional context or description of the transaction.
   - Common alternative terms:
     - "catatan"
     - "keterangan"
     - "deskripsi"
     - "remarks"
     - "note"
   - If no explicit notes exist, infer a short description based on the transaction content.
   - If nothing meaningful can be inferred, return null.

4. date
   - The transaction date.
   - Accept formats such as:
     - DD-MM-YYYY
     - YYYY-MM-DD
     - DD/MM/YYYY
     - Textual dates (e.g., "12 Januari 2024")
   - Convert the date to ISO 8601 format: YYYY-MM-DD.
   - If multiple dates appear, choose the transaction or payment date.
   - If no date is found, return null.

OUTPUT RULES:
- Return ONLY valid JSON.
- Do NOT include explanations, comments, or extra text.
- Use this exact JSON structure:

{
  "vendor_name": string | null,
  "total_idr": number | null,
  "notes": string | null,
  "date": string | null
}
`;

export default {
	/**
	 * Main request handler for the Worker
	 */
	async fetch(
		request: Request,
		env: Env,
		ctx: ExecutionContext,
	): Promise<Response> {
		const url = new URL(request.url);

		// Health check endpoint
		if (url.pathname === "/health" && request.method === "GET") {
			return new Response(
				JSON.stringify({
					status: "healthy",
					service: "invoice-extraction-api",
					timestamp: new Date().toISOString(),
				}),
				{
					headers: {
						"Content-Type": "application/json",
						"Access-Control-Allow-Origin": "*",
					},
				},
			);
		}

		// Handle CORS preflight
		if (request.method === "OPTIONS") {
			return handleCORS();
		}

		// Invoice extraction endpoint
		if (url.pathname === "/api/extract" || url.pathname === "/extract") {
			if (request.method === "POST") {
				return handleExtractRequest(request, env);
			}

			return jsonResponse(
				{ success: false, error: "Method not allowed. Use POST." },
				405,
			);
		}

		// 404 for unknown routes
		return jsonResponse(
			{
				success: false,
				error: "Not found. Use POST /api/extract with image data.",
			},
			404,
		);
	},
} satisfies ExportedHandler<Env>;

/**
 * Handles invoice extraction requests
 */
async function handleExtractRequest(
	request: Request,
	env: Env,
): Promise<Response> {
	const startTime = Date.now();

	try {
		// Validate content type
		const contentType = request.headers.get("Content-Type") || "";

		let imageBuffer: ArrayBuffer;
		
		if (SUPPORTED_MIME_TYPES.some((type) => contentType.includes(type))) {
			imageBuffer = await request.arrayBuffer();
		} else {
			return jsonResponse(
				{
					success: false,
					error: `Unsupported Content-Type. Send raw image (${SUPPORTED_MIME_TYPES.join(", ")}) or JSON with base64 "image" field.`,
				},
				400,
			);
		}

		// Validate image size
		if (imageBuffer.byteLength === 0) {
			return jsonResponse(
				{ success: false, error: "Empty image data received" },
				400,
			);
		}

		if (imageBuffer.byteLength > MAX_IMAGE_SIZE) {
			return jsonResponse(
				{
					success: false,
					error: `Image too large. Maximum size is ${MAX_IMAGE_SIZE / 1024 / 1024}MB`,
				},
				413,
			);
		}

		const imageArray = Array.from(new Uint8Array(imageBuffer));
		// Convert to array for Workers AI
		const input = {
			image: imageArray,
			prompt: EXTRACTION_PROMPT,
			max_tokens: 512,
		};
		
		const aiResponse = await env.AI.run(
			MODEL_ID,
			input
		);

		// // Call Workers AI vision model
		// const aiResponse = await env.AI.run(MODEL_ID, 
		// 	{
		// 	image: imageArray,
		// 	prompt: EXTRACTION_PROMPT,
		// 	max_tokens: 1024,
		// });

		// Extract and parse JSON from response
		const extractedData = parseAIResponse(aiResponse);

		const processingTime = Date.now() - startTime;

		const response: ExtractResponse = {
			success: true,
			data: extractedData,
			metadata: {
				model: MODEL_ID,
				processing_time_ms: processingTime,
			},
		};

		return jsonResponse(response, 200);
	} catch (error) {
		console.error("Invoice extraction error:", error);

		const response: ExtractResponse = {
			success: false,
			error: error instanceof Error ? error.message : "Unknown error occurred",
		};

		return jsonResponse(response, 500);
	}
}

/**
 * Parses AI response and extracts structured invoice data
 */
function parseAIResponse(response: any): InvoiceData {
	try {
		// Extract text from various possible response formats
		const text = response.description || response.text || JSON.stringify(response);

		// Try to find JSON object in response
		const jsonMatch = text.match(/\{[\s\S]*\}/);

		if (!jsonMatch) {
			throw new Error("No JSON object found in AI response");
		}

		// Parse the JSON
		const parsed = JSON.parse(jsonMatch[0]);

		// Validate that it has the expected structure
		const invoiceData: InvoiceData = {
			vendor_name: parsed.vendor_name || null,
			date: parsed.date || null,
			total_idr: parsed.total_idr || null,
			notes: parsed.notes || null,
		};
 return invoiceData;
	} catch (error) {
		console.error("Failed to parse AI response:", error);
		throw new Error(`Failed to parse invoice data from AI response: ${error instanceof Error ? error.message : "Unknown parsing error"}`);
	}
}

/**
 * Helper function to create JSON responses with CORS headers
 */
function jsonResponse(data: any, status: number = 200): Response {
	return new Response(JSON.stringify(data, null, 2), {
		status,
		headers: {
			"Content-Type": "application/json",
			"Access-Control-Allow-Origin": "*",
			"Access-Control-Allow-Methods": "POST, OPTIONS",
			"Access-Control-Allow-Headers": "Content-Type",
		},
	});
}

/**
 * Handles CORS preflight requests
 */
function handleCORS(): Response {
	return new Response(null, {
		status: 204,
		headers: {
			"Access-Control-Allow-Origin": "*",
			"Access-Control-Allow-Methods": "POST, OPTIONS",
			"Access-Control-Allow-Headers": "Content-Type",
			"Access-Control-Max-Age": "86400",
		},
	});
}
