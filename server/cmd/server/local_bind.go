package main

import (
	"fmt"
	"net"
	"strconv"
	"strings"
)

func listenAddressForMode(port, localModeValue, configuredAddress string) (string, error) {
	localMode := false
	if value := strings.TrimSpace(localModeValue); value != "" {
		parsed, err := strconv.ParseBool(value)
		if err != nil {
			return "", fmt.Errorf("invalid INKWAY_LOCAL_MODE: %w", err)
		}
		localMode = parsed
	}
	if !localMode {
		return ":" + port, nil
	}
	if strings.TrimSpace(configuredAddress) == "" {
		configuredAddress = net.JoinHostPort("127.0.0.1", port)
	}
	return localOnlyListenAddress(configuredAddress)
}

// localOnlyListenAddress validates the HTTP listener address used by the
// desktop's future local mode. The desktop mode must never bind an
// unauthenticated listener to a LAN or public interface.
func localOnlyListenAddress(address string) (string, error) {
	address = strings.TrimSpace(address)
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return "", fmt.Errorf("invalid local listen address: %w", err)
	}
	ip := net.ParseIP(host)
	if ip == nil || !ip.IsLoopback() {
		return "", fmt.Errorf("local mode requires a loopback IP address, got %q", host)
	}
	if port == "" {
		return "", fmt.Errorf("local listen address requires a port")
	}
	return net.JoinHostPort(ip.String(), port), nil
}
