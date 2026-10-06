package main

import "testing"

func TestLocalOnlyListenAddress(t *testing.T) {
	tests := []struct {
		name    string
		address string
		want    string
		wantErr bool
	}{
		{name: "IPv4 loopback", address: "127.0.0.1:8080", want: "127.0.0.1:8080"},
		{name: "IPv6 loopback", address: "[::1]:8080", want: "[::1]:8080"},
		{name: "wildcard", address: ":8080", wantErr: true},
		{name: "LAN IPv4", address: "192.168.1.2:8080", wantErr: true},
		{name: "hostname", address: "localhost:8080", wantErr: true},
		{name: "missing port", address: "127.0.0.1", wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := localOnlyListenAddress(tt.address)
			if (err != nil) != tt.wantErr {
				t.Fatalf("localOnlyListenAddress(%q) error = %v, wantErr %v", tt.address, err, tt.wantErr)
			}
			if err == nil && got != tt.want {
				t.Fatalf("localOnlyListenAddress(%q) = %q, want %q", tt.address, got, tt.want)
			}
		})
	}
}

func TestListenAddressForMode(t *testing.T) {
	tests := []struct {
		name    string
		port    string
		mode    string
		address string
		want    string
		wantErr bool
	}{
		{name: "server mode preserves configured wildcard behavior", port: "8080", want: ":8080"},
		{name: "local mode defaults to IPv4 loopback", port: "8080", mode: "true", want: "127.0.0.1:8080"},
		{name: "local mode rejects wildcard", port: "8080", mode: "true", address: ":8080", wantErr: true},
		{name: "invalid mode fails", port: "8080", mode: "sometimes", wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := listenAddressForMode(tt.port, tt.mode, tt.address)
			if (err != nil) != tt.wantErr {
				t.Fatalf("listenAddressForMode() error = %v, wantErr %v", err, tt.wantErr)
			}
			if err == nil && got != tt.want {
				t.Fatalf("listenAddressForMode() = %q, want %q", got, tt.want)
			}
		})
	}
}
