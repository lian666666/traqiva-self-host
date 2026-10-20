// Traqiva entry point, Copyright 2026 Traqiva contributors.
// Uses the Apache-2.0 Caveman v4.0.1 core; this wrapper is an independent addition.
// All persistent state is explicitly rooted in TRAQIVA_HOME / ~/.traqiva.
package main

import (
  "bytes"
  "encoding/json"
  "fmt"
  "io"
  "os"
  "path/filepath"
  "strconv"
  "strings"

  "github.com/JuliusBrussee/caveman/engine"
  "github.com/JuliusBrussee/caveman/engine/ccr"
  "github.com/JuliusBrussee/caveman/engine/tokens"
)

var version = "0.1.0"
const maxInput = 1 << 20

type Receipt struct {
  CompressedText string `json:"compressedText"`
  Algorithm string `json:"algorithm"`
  OriginalTokensEstimate int `json:"original_tokens_estimate"`
  OptimizedTokensEstimate int `json:"optimized_tokens_estimate"`
  TokenBasis string `json:"token_basis"`
  Tokenizer string `json:"tokenizer"`
  EvidenceBasis string `json:"evidence_basis"`
  RecoveryHandle string `json:"recovery_handle"`
  RecoveryVerified bool `json:"recovery_verified"`
  Changed bool `json:"changed"`
  ContentType string `json:"content_type"`
  Runtime string `json:"runtime"`
  LosslessToModel *bool `json:"lossless_to_model,omitempty"`
  Note string `json:"note,omitempty"`
}

func openStore() (*ccr.Store, error) {
  home := os.Getenv("TRAQIVA_HOME")
  if home == "" {
    userHome, err := os.UserHomeDir()
    if err != nil { return nil, err }
    home = filepath.Join(userHome, ".traqiva")
  }
  absolute, err := filepath.Abs(home)
  if err != nil { return nil, err }
  if err := os.MkdirAll(absolute, 0700); err != nil { return nil, err }
  budget := int64(512 << 20)
  if raw := os.Getenv("TRAQIVA_CCR_MAX_BYTES"); raw != "" {
    value, err := strconv.ParseInt(raw, 10, 64)
    if err != nil || value <= 0 { return nil, fmt.Errorf("TRAQIVA_CCR_MAX_BYTES must be a positive integer") }
    budget = value
  }
  return ccr.OpenWithBudget(filepath.Join(absolute, "recovery.db"), budget)
}

func compressPayload(input []byte, contentType string) (Receipt, error) {
  store, err := openStore()
  if err != nil { return Receipt{}, fmt.Errorf("cannot open Traqiva recovery store: %w", err) }
  defer store.Close()
  core := engine.New(store, nil)
  result, compressionError := core.Compress(input, engine.Options{Mode: engine.ModeCompress, Type: contentType})
  // Traqiva-specific wrapper presentation. Keep upstream algorithms unmodified,
  // retain exact originals in CCR, and re-count any renamed elision marker.
  if !bytes.Equal(input, result.Output) && bytes.Contains(result.Output, []byte("(caveman)")) {
    result.Output = []byte(strings.ReplaceAll(string(result.Output), "(caveman)", "(traqiva)"))
    result.TokensAfter = tokens.Default().Count(result.Output)
    if result.TokensAfter >= result.TokensBefore {
      result.Output = input
      result.TokensAfter = result.TokensBefore
      result.RecoveryHandle = ""
      result.Method = ""
    }
  }
  receipt := Receipt{
    CompressedText: string(result.Output), Algorithm: result.Method,
    OriginalTokensEstimate: result.TokensBefore, OptimizedTokensEstimate: result.TokensAfter,
    TokenBasis: "estimated", Tokenizer: result.TokenCountBasis, EvidenceBasis: "inferred",
    RecoveryHandle: result.RecoveryHandle, Changed: !bytes.Equal(input, result.Output),
    ContentType: result.ContentType, Runtime: "native", LosslessToModel: result.LosslessToModel,
  }
  if receipt.Algorithm == "" { receipt.Algorithm = "none" }
  if compressionError != nil {
    if receipt.Changed { return Receipt{}, fmt.Errorf("unsafe compression result rejected") }
    receipt.Note = "Recovery storage could not accept a new original; unchanged input returned."
  }
  if receipt.RecoveryHandle != "" {
    original, err := core.Retrieve(receipt.RecoveryHandle)
    if err != nil || !bytes.Equal(original, input) { return Receipt{}, fmt.Errorf("exact recovery verification failed; transformed output withheld") }
    receipt.RecoveryVerified = true
    receipt.RecoveryHandle = "local:" + receipt.RecoveryHandle
  } else if receipt.Changed {
    return Receipt{}, fmt.Errorf("transformed result without exact local recovery was withheld")
  }
  return receipt, nil
}

func retrievePayload(handle string) ([]byte, error) {
  if len(handle) > 512 { return nil, fmt.Errorf("invalid recovery handle") }
  if len(handle) >= 6 && handle[:6] == "local:" { handle = handle[6:] }
  store, err := openStore()
  if err != nil { return nil, err }
  defer store.Close()
  return engine.New(store, nil).Retrieve(handle)
}

func run(args []string, input io.Reader, output io.Writer) error {
  if len(args) == 0 { return fmt.Errorf("usage: traqiva-engine compress [--type TYPE] | retrieve HANDLE | stats | version") }
  switch args[0] {
  case "version":
    return json.NewEncoder(output).Encode(map[string]any{"name":"Traqiva Engine", "version":version,"schema":"traqiva.engine.v1", "upstream":"Caveman v4.0.1 (Apache-2.0)","cgo":false,"code_languages":[]string{"Go"},"evidence_basis":"inferred","capabilities":[]string{"compress","retrieve","stats"}})
  case "compress":
    contentType := ""
    if len(args) == 3 && args[1] == "--type" { contentType = args[2] } else if len(args) != 1 { return fmt.Errorf("usage: traqiva-engine compress [--type TYPE]") }
    data, err := io.ReadAll(io.LimitReader(input, maxInput+1))
    if err != nil { return err }
    if len(data) > maxInput { return fmt.Errorf("input exceeds 1 MiB") }
    result, err := compressPayload(data, contentType)
    if err != nil { return err }
    return json.NewEncoder(output).Encode(result)
  case "retrieve":
    if len(args) != 2 { return fmt.Errorf("usage: traqiva-engine retrieve HANDLE") }
    data, err := retrievePayload(args[1])
    if err != nil { return err }
    return json.NewEncoder(output).Encode(map[string]any{"original":string(data),"runtime":"native"})
  case "stats":
    if len(args) != 1 { return fmt.Errorf("stats accepts no arguments") }
    store, err := openStore()
    if err != nil { return err }
    defer store.Close()
    result, err := engine.New(store, nil).Stats()
    if err != nil { return err }
    return json.NewEncoder(output).Encode(map[string]any{"runtime":"native","evidence_basis":"inferred","stats":result})
  default:
    return fmt.Errorf("unsupported Traqiva engine command")
  }
}

func main() {
  if err := run(os.Args[1:], os.Stdin, os.Stdout); err != nil { fmt.Fprintln(os.Stderr, "Traqiva Engine:", err); os.Exit(1) }
}
