CREATE TABLE runtime_microloop_health (
    runtime_id UUID PRIMARY KEY REFERENCES agent_runtime(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('connected', 'degraded', 'unavailable')),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE runtime_microloop_sites (
    runtime_id UUID NOT NULL REFERENCES agent_runtime(id) ON DELETE CASCADE,
    site_name TEXT NOT NULL,
    site_version TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('OBSERVE', 'CANDIDATE', 'SHADOW', 'ACTIVE', 'DEMOTED', 'RETIRED')),
    observations BIGINT NOT NULL CHECK (observations >= 0),
    verified_outcomes BIGINT NOT NULL CHECK (verified_outcomes >= 0),
    fast_served BIGINT NOT NULL CHECK (fast_served >= 0),
    coverage DOUBLE PRECISION NOT NULL CHECK (coverage >= 0 AND coverage <= 1),
    false_serves BIGINT NOT NULL CHECK (false_serves >= 0),
    last_maintenance TIMESTAMPTZ,
    model_calls_avoided BIGINT CHECK (model_calls_avoided >= 0),
    savings_basis TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (runtime_id, site_name, site_version)
);
