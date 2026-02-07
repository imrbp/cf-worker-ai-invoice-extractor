interface ExtractRequest {
    image: string; // base64
  }
  
interface ExtractResponse {
    success: boolean;
    data?: InvoiceData;
    error?: string;
    raw_response?: any;
}
