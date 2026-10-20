package main

import (
  "strings"
  "testing"
)

func TestLogCompressionRecoversExactOriginal(t *testing.T) {
  t.Setenv("TRAQIVA_HOME", t.TempDir())
  input := "2026-10-20 INFO start\n" + strings.Repeat("2026-10-20 INFO worker=jobs request succeeded status=200 elapsed=2ms\n", 300) + "2026-10-20 ERROR code=DB_TIMEOUT retry=true\n2026-10-20 INFO end\n"
  receipt, err := compressPayload([]byte(input), "log")
  if err != nil { t.Fatal(err) }
  if !receipt.Changed || receipt.RecoveryHandle == "" || receipt.OptimizedTokensEstimate >= receipt.OriginalTokensEstimate { t.Fatalf("expected a genuine reduction, got %+v", receipt) }
  if !strings.Contains(receipt.CompressedText, "DB_TIMEOUT") { t.Fatal("error line was dropped") }
  original, err := retrievePayload(receipt.RecoveryHandle)
  if err != nil { t.Fatal(err) }
  if string(original) != input { t.Fatal("recovery must return exact original bytes across separate store opens") }
  if receipt.EvidenceBasis != "inferred" || !receipt.RecoveryVerified { t.Fatal("receipt must disclose local evidence and verified recovery") }
}

func TestUncompressibleInputPassesThrough(t *testing.T) {
  t.Setenv("TRAQIVA_HOME", t.TempDir())
  original := []byte("one short sentence")
  receipt, err := compressPayload(original, "text")
  if err != nil { t.Fatal(err) }
  if receipt.CompressedText != string(original) || receipt.Changed || receipt.RecoveryHandle != "" { t.Fatalf("pass-through must not claim compression: %+v", receipt) }
}

func TestMissingRecoveryFails(t *testing.T) {
  t.Setenv("TRAQIVA_HOME", t.TempDir())
  if _, err := retrievePayload("ccr_not_present"); err == nil { t.Fatal("unknown recovery cannot report success") }
}
