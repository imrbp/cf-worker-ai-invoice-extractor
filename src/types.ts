/**
 * Type definitions for the invoice extraction API.
 */

export interface Env {
	/**
	 * Binding for the Workers AI API.
	 */
	AI: Ai;
}

/**
 * Structured invoice data extracted from images.
 */
export interface InvoiceData {
	vendor_name: string | null;
	date: string | null,
	total_idr: string | null;
	notes: string | null;
}
const EXTRACTION_PROMPT = `Extract invoice data as JSON. Use null for missing fields. Current Currency are Rupiah or IDR. Return only valid JSON:
{
  "vendor_name": null,
  "date": null,
  "total_idr": null,
  "notes": null
}`;


/**
 * API response for successful extraction.
 */
export interface ExtractSuccessResponse {
	success: true;
	data: InvoiceData;
	metadata: {
		model: string;
		processing_time_ms: number;
	};
}

/**
 * API response for failed extraction.
 */
export interface ExtractErrorResponse {
	success: false;
	error: string;
	raw_response?: any;
}

/**
 * Combined API response type.
 */
export type ExtractResponse = ExtractSuccessResponse | ExtractErrorResponse;
