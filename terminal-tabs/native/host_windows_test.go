//go:build windows

package main

import "testing"

func TestInputQueueRemainsNonblockingWhenReaderStalls(t *testing.T) {
  s:=&session{input:make(chan string,2),done:make(chan struct{})}
  if !s.queueInput("one") || !s.queueInput("two") {t.Fatal("failed to enqueue within capacity")}
  if s.queueInput("three") {t.Fatal("accepted input beyond bounded queue capacity")}
  close(s.done)
  if s.queueInput("four") {t.Fatal("accepted input after session shutdown")}
}
