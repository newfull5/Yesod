package main

import "testing"

func TestHostAllowed(t *testing.T) {
	cases := []struct {
		host, allow string
		want        bool
	}{
		{"localhost:8080", "", true},
		{"127.0.0.1:8080", "", true},
		{"192.168.1.5:8080", "", true},
		{"10.0.0.2", "", true},
		{"172.16.0.5:8080", "", true},
		{"attacker.com", "", false},
		{"93.184.216.34", "", false}, // public IP, no rebinding allowlist
		{"my.host.example:8080", "my.host.example", true},
		{"my.host.example:8080", "", false},
	}
	for _, c := range cases {
		if got := hostAllowed(c.host, c.allow); got != c.want {
			t.Errorf("hostAllowed(%q, %q) = %v, want %v", c.host, c.allow, got, c.want)
		}
	}
}
