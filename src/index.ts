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
const EXTRACTION_PROMPT = `Extract invoice data as JSON. Use null for missing fields. Format currency as "Rp X.XXX.XXX". Return only valid JSON:
{
  "vendor_name": null,
  "vendor_address": null,
  "invoice_number": null,
  "invoice_date": null,
  "due_date": null,
  "subtotal": null,
  "tax": null,
  "total_idr": null,
  "line_items": null,
  "payment_terms": null,
  "notes": null
}`;

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

		// Handle different input formats
		if (contentType.includes("application/json")) {
			// Accept base64 encoded image in JSON
			const body = await request.json();
			if (!body.image) {
				return jsonResponse(
					{
						success: false,
						error: 'Missing "image" field in JSON body (base64 string expected)',
					},
					400,
				);
			}

			// Decode base64
			const base64Data = body.image.replace(/^data:image\/\w+;base64,/, "");
			const binaryString = atob(base64Data);
			const bytes = new Uint8Array(binaryString.length);
			for (let i = 0; i < binaryString.length; i++) {
				bytes[i] = binaryString.charCodeAt(i);
			}
			imageBuffer = bytes.buffer;
		} else if (
			SUPPORTED_MIME_TYPES.some((type) => contentType.includes(type))
		) {
			// Accept raw image binary
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

		// Convert to array for Workers AI
		const imageArray = Array.from(new Uint8Array(imageBuffer));

		// Call Workers AI vision model
		const aiResponse = await env.AI.run(MODEL_ID, {
			image: imageArray,
			prompt: EXTRACTION_PROMPT,
			max_tokens: 1024,
		});

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
			vendor_address: parsed.vendor_address || null,
			invoice_number: parsed.invoice_number || null,
			invoice_date: parsed.invoice_date || null,
			due_date: parsed.due_date || null,
			subtotal: parsed.subtotal || null,
			tax: parsed.tax || null,
			total_idr: parsed.total_idr || null,
			line_items: parsed.line_items || null,
			payment_terms: parsed.payment_terms || null,
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
