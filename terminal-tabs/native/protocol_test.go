package main

import (
  "bytes"
  "encoding/binary"
  "encoding/json"
  "io"
  "strings"
  "sync"
  "testing"
)

func framed(data string) []byte {
  var out bytes.Buffer
  _ = binary.Write(&out, binary.LittleEndian, uint32(len(data)))
  out.WriteString(data)
  return out.Bytes()
}

func TestReadFrame(t *testing.T) {
  m, err := readFrame(bytes.NewReader(framed(`{"type":"start","profile":"powershell","cols":80,"rows":24}`)))
  if err != nil || m.Type != "start" || m.Profile != "powershell" || m.Cols != 80 { t.Fatalf("%+v %v",m,err) }
  for _, bad := range []string{
    `{"type":"start","oops":7}`,
    `{"type":"start"}{}`,
    "not json",
  } {
    if _, err := readFrame(bytes.NewReader(framed(bad))); err == nil { t.Fatalf("accepted %s",bad) }
  }
  var oversized bytes.Buffer
  _ = binary.Write(&oversized, binary.LittleEndian, uint32(maxInboundFrame+1))
  if _, err := readFrame(&oversized); err == nil { t.Fatal("accepted oversized input") }
  if _, err := readFrame(bytes.NewReader(framed(`{"type":"input","data":"test"}`)[:7])); err == nil { t.Fatal("accepted truncated input") }
  if _, err := readFrame(bytes.NewReader(nil)); err != io.EOF { t.Fatalf("expected EOF; got %v",err) }
}

type shortWriter struct { bytes.Buffer }
func (w *shortWriter) Write(b []byte) (int,error) {
  if len(b)>3 { b=b[:3] }
  return w.Buffer.Write(b)
}
func TestFramedOutputAndConcurrentWriters(t *testing.T) {
  out:=&shortWriter{}
  w:=&frameWriter{writer:out}
  var wg sync.WaitGroup
  for i:=0;i<100;i++ { wg.Add(1); go func(){defer wg.Done();if err:=w.send(response{Type:"data",Data:"AAA"});err!=nil{t.Error(err)}}() }
  wg.Wait()
  for i:=0;i<100;i++ {
    var n uint32
    if err:=binary.Read(out,binary.LittleEndian,&n);err!=nil{t.Fatal(err)}
    b:=make([]byte,n)
    if _,err:=io.ReadFull(out,b);err!=nil{t.Fatal(err)}
    var got response
    if err:=json.Unmarshal(b,&got);err!=nil || got.Type!="data"{t.Fatalf("%s %v",b,err)}
  }
  if out.Len()!=0 {t.Fatal("extra bytes")}
}

func TestValidation(t *testing.T){
  for _,p :=range []string{"powershell","cmd","pwsh","wsl"} {if !validProfile(p){t.Error(p)}}
  for _,p :=range []string{"","./cmd.exe","powershell -enc evil","../pwsh","CMD"} {if validProfile(p){t.Error(p)}}
  if !validSize(80,24) || validSize(0,24) || validSize(600,24) || validSize(80,251) {t.Fatal("invalid size bounds")}
  if strings.TrimSpace(" ") != "" {t.Fatal("broken test fixture")}
}
