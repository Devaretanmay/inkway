package main

import (
	"reflect"
	"testing"
)

func TestLocalModeAllowedOriginsIncludePackagedElectron(t *testing.T) {
	t.Setenv("CORS_ALLOWED_ORIGINS", "")
	t.Setenv("FRONTEND_ORIGIN", "")
	t.Setenv("INKWAY_LOCAL_MODE", "true")
	want := []string{"null", "file://", "http://localhost:5173", "http://localhost:5174"}
	if got := allowedOrigins(); !reflect.DeepEqual(got, want) {
		t.Fatalf("allowedOrigins() = %v, want %v", got, want)
	}
}

func TestConfiguredAllowedOriginsRemainExplicit(t *testing.T) {
	t.Setenv("INKWAY_LOCAL_MODE", "true")
	t.Setenv("CORS_ALLOWED_ORIGINS", "http://127.0.0.1:44123")
	if got, want := allowedOrigins(), []string{"http://127.0.0.1:44123"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("allowedOrigins() = %v, want %v", got, want)
	}
}
