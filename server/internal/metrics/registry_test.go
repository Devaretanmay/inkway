package metrics

import "testing"

func TestRegistryExcludesDatabaseSampledMetrics(t *testing.T) {
	registry := NewRegistry(RegistryOptions{})
	families, err := registry.Gatherer.Gather()
	if err != nil {
		t.Fatalf("gather metrics: %v", err)
	}

	retired := map[string]struct{}{
		"inkway_agent_task_queued":                               {},
		"inkway_agent_task_running":                              {},
		"inkway_agent_task_stuck_total":                          {},
		"inkway_business_sampler_query_errors_total":             {},
		"inkway_business_sampler_query_seconds":                  {},
		"inkway_workspace_total":                                 {},
		"inkway_seat_capacity_outbox_pending":                    {},
		"inkway_seat_capacity_outbox_dead_lettered":              {},
		"inkway_seat_capacity_outbox_oldest_pending_age_seconds": {},
		"inkway_channel_media_pending_objects":                   {},
		"inkway_channel_media_tombstoned_objects":                {},
		"inkway_runtime_gc_blocked_observation_failed_total":     {},
		"inkway_runtime_gc_blocked_runtimes":                     {},
		"inkway_runtime_gc_backlog_runtimes":                     {},
	}
	for _, family := range families {
		if _, found := retired[family.GetName()]; found {
			t.Errorf("retired database-sampled metric %q is still registered", family.GetName())
		}
	}
}
