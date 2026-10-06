// Package analytics retains the local business-event vocabulary used for
// in-process operational counters. Inkway does not transmit these events.
package analytics

import "time"

type Event struct {
	Name        string
	DistinctID  string
	WorkspaceID string
	Properties  map[string]any
	SetOnce     map[string]any
	Set         map[string]any
	Timestamp   time.Time
}

type Client interface {
	Capture(Event)
	Close()
}

type NoopClient struct{}

func (NoopClient) Capture(Event) {}
func (NoopClient) Close()        {}

func NewFromEnv() Client { return NoopClient{} }
