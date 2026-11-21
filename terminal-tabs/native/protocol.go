package main

import (
  "bytes"
  "encoding/binary"
  "encoding/json"
  "errors"
  "fmt"
  "io"
  "sync"
)

const maxInboundFrame = 32768
const maxOutboundFrame = 65536

type request struct {
  Type string `json:"type"`
  Profile string `json:"profile,omitempty"`
  Cols int `json:"cols,omitempty"`
  Rows int `json:"rows,omitempty"`
  Data string `json:"data,omitempty"`
}

type response struct {
  Type string `json:"type"`
  Data string `json:"data,omitempty"`
  Message string `json:"message,omitempty"`
  Code int64 `json:"code,omitempty"`
}

func readFrame(r io.Reader) (request, error) {
  var size uint32
  if err := binary.Read(r, binary.LittleEndian, &size); err != nil {
    return request{}, err
  }
  if size < 2 || size > maxInboundFrame {
    return request{}, fmt.Errorf("invalid native message length %d", size)
  }
  data := make([]byte, size)
  if _, err := io.ReadFull(r, data); err != nil {
    return request{}, err
  }
  dec := json.NewDecoder(bytes.NewReader(data))
  dec.DisallowUnknownFields()
  var msg request
  if err := dec.Decode(&msg); err != nil {
    return request{}, err
  }
  var unused any
  if err := dec.Decode(&unused); !errors.Is(err, io.EOF) {
    return request{}, errors.New("native message must contain exactly one object")
  }
  return msg, nil
}

type frameWriter struct {
  sync.Mutex
  writer io.Writer
}

func (w *frameWriter) send(msg response) error {
  b, err := json.Marshal(msg)
  if err != nil { return err }
  if len(b) > maxOutboundFrame { return errors.New("outbound message too large") }
  w.Lock()
  defer w.Unlock()
  var prefix [4]byte
  binary.LittleEndian.PutUint32(prefix[:], uint32(len(b)))
  // Standard io.Writer may legally return a short write without an error.
  for _, part := range [][]byte{prefix[:], b} {
    for len(part) > 0 {
      n, err := w.writer.Write(part)
      if err != nil { return err }
      if n <= 0 { return io.ErrShortWrite }
      part = part[n:]
    }
  }
  return nil
}

func validProfile(s string) bool {
  switch s {
  case "powershell", "cmd", "pwsh", "wsl": return true
  default: return false
  }
}

func validSize(cols, rows int) bool {
  return cols >= 20 && cols <= 500 && rows >= 5 && rows <= 250
}
