package config

import (
	"testing"
	"time"
)

func TestBuildUploadDir(t *testing.T) {
	now := time.Date(2026, 7, 15, 10, 30, 0, 0, time.Local)

	cases := []struct {
		name  string
		style string
		want  string
	}{
		{"empty", "", "uploads"},
		{"none", "none", "uploads"},
		{"NONE", "NONE", "uploads"},
		{"date", "date", "uploads/2026/07/15"},
		{"DATE", "DATE", "uploads/2026/07/15"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			sc := &StorageConfig{DirStructure: tc.style}
			got := sc.BuildUploadDir(now)
			if got != tc.want {
				t.Fatalf("BuildUploadDir(%q) = %q, want %q", tc.style, got, tc.want)
			}
		})
	}

	if got := (*StorageConfig)(nil).BuildUploadDir(now); got != "uploads" {
		t.Fatalf("nil config should fallback to uploads, got %q", got)
	}
}

func TestStorageDirStructureValidate(t *testing.T) {
	sc := NewStorageConfig()
	sc.DirStructure = "weekly"
	if err := sc.Validate(); err == nil {
		t.Fatal("expected invalid dir_structure error")
	}

	sc.DirStructure = "date"
	if err := sc.Validate(); err != nil {
		t.Fatalf("date should be valid: %v", err)
	}
	if sc.DirStructure != "date" {
		t.Fatalf("normalized DirStructure = %q", sc.DirStructure)
	}
}
