package config

import (
	"testing"
	"time"
)

func TestBuildUploadDir(t *testing.T) {
	now := time.Date(2026, 7, 15, 10, 30, 0, 0, time.Local)

	cases := []struct {
		name        string
		style       string
		storagePath string
		want        string
	}{
		{"empty", "", "", "uploads"},
		{"none", "none", "", "uploads"},
		{"NONE", "NONE", "", "uploads"},
		{"date", "date", "", "uploads/2026/07/15"},
		{"DATE", "DATE", "", "uploads/2026/07/15"},
		// storagepath 已指向 uploads 时，不再套一层 uploads/
		{"none_under_uploads_root", "none", "/data/FileCodeBox/uploads", ""},
		{"date_under_uploads_root", "date", "/data/FileCodeBox/uploads", "2026/07/15"},
		{"date_under_uploads_root_slash", "date", "/data/FileCodeBox/uploads/", "2026/07/15"},
		{"date_under_data_root", "date", "/data/FileCodeBox/data", "uploads/2026/07/15"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			sc := &StorageConfig{DirStructure: tc.style, StoragePath: tc.storagePath}
			got := sc.BuildUploadDir(now)
			if got != tc.want {
				t.Fatalf("BuildUploadDir(style=%q, path=%q) = %q, want %q", tc.style, tc.storagePath, got, tc.want)
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
