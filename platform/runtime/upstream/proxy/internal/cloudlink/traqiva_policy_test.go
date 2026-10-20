// Traqiva-specific policy test, Copyright 2026 Traqiva contributors.
package cloudlink

import (
  "os"
  "path/filepath"
  "testing"
)

func TestTraqivaCloudDisabledBeforeCredentialLookup(t *testing.T) {
  home := t.TempDir()
  if err := os.WriteFile(filepath.Join(home, "cloud.json"), []byte(`{"baseURL":"https://api.caveman.so","modules":{"routing":true},"tokenStore":"keychain"}`), 0600); err != nil { t.Fatal(err) }
  link := New(home, nil)
  called := false
  link.keychain = func() string { called = true; return "must-not-read" }
  config := link.settings()
  if !config.offline || !config.noTelemetry || config.signedIn() || config.routing || called { t.Fatal("Traqiva must never load Caveman Cloud credentials, routing or telemetry") }
}
