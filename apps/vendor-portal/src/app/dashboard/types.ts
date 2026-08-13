export interface HealthResponse {
  success: boolean;
  data: {
    service: string;
    status: string;
    timestamp: string;
  };
}
