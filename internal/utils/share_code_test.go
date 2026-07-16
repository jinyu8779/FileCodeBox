package utils

import "testing"

func TestNormalizeShareCode(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		{"Ab12Cd34", "Ab12Cd34"},
		{"  Ab12Cd34  ", "Ab12Cd34"},
		{"/share/download?code=Ab12Cd34", "Ab12Cd34"},
		{"https://example.com/share/download?code=Ab12Cd34", "Ab12Cd34"},
		{"https://example.com/share/download?code=Ab12Cd34&x=1", "Ab12Cd34"},
		{"http://localhost:1234/s/Ab12Cd34", "Ab12Cd34"},
		{"/s/Ab12Cd34", "Ab12Cd34"},
		{"https://example.com/api/v1/share/Ab12Cd34", "Ab12Cd34"},
		{`"https://example.com/share/download?code=Xy9"`, "Xy9"},
	}

	for _, tc := range cases {
		got := NormalizeShareCode(tc.in)
		if got != tc.want {
			t.Fatalf("NormalizeShareCode(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}
