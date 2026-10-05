export interface InkRuntimeHealth {
  runtime_id: string;
  status: "connected" | "degraded" | "unavailable";
  updated_at?: string;
}

export interface InkFastPathSite {
  runtime_id: string;
  site_name: string;
  site_version: string;
  status: "OBSERVE" | "CANDIDATE" | "SHADOW" | "ACTIVE" | "DEMOTED" | "RETIRED";
  observations: number;
  verified_outcomes: number;
  fast_served: number;
  coverage: number;
  false_serves: number;
  last_maintenance?: string;
  model_calls_avoided?: number;
  savings_basis?: string;
  updated_at: string;
}

export interface InkFastPathsResponse {
  runtimes: InkRuntimeHealth[];
  sites: InkFastPathSite[];
}
