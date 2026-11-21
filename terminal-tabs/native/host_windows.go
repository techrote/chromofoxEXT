//go:build windows

package main

// One Firefox native-messaging port = one host process = at most one ConPTY.
// The process is born suspended, assigned to a kill-on-close Windows Job Object,
// and only then resumed. This is intended to stop subprocess trees if Firefox
// closes a tab or crashes. It has not been qualified on the owner's Windows PC.

import (
  "encoding/base64"
  "errors"
  "fmt"
  "io"
  "os"
  "os/exec"
  "path/filepath"
  "runtime"
  "strings"
  "sync"
  "syscall"
  "unsafe"
)

const extendedStartupInfoPresent = 0x00080000
const createSuspended = 0x00000004
const procThreadAttributePseudoConsole = 0x00020016
const jobObjectExtendedLimitInformation = 9
const jobObjectLimitKillOnJobClose = 0x00002000
const infiniteWait = 0xffffffff

func stage(message string) {
  if os.Getenv("CHROMOFOX_TERM_DEBUG")=="1" {fmt.Fprintln(os.Stderr,"chromofox-native: "+message)}
}

var kernel32 = syscall.NewLazyDLL("kernel32.dll")
var createPseudo = kernel32.NewProc("CreatePseudoConsole")
var resizePseudo = kernel32.NewProc("ResizePseudoConsole")
var closePseudo = kernel32.NewProc("ClosePseudoConsole")
var initAttributes = kernel32.NewProc("InitializeProcThreadAttributeList")
var updateAttributes = kernel32.NewProc("UpdateProcThreadAttribute")
var deleteAttributes = kernel32.NewProc("DeleteProcThreadAttributeList")
var createJob = kernel32.NewProc("CreateJobObjectW")
var setJobInfo = kernel32.NewProc("SetInformationJobObject")
var assignJob = kernel32.NewProc("AssignProcessToJobObject")
var resumeThread = kernel32.NewProc("ResumeThread")

// Windows structures must have the C ABI field order and alignment.
type startupInfoEx struct {
  syscall.StartupInfo
  AttributeList uintptr
}
type basicLimitInfo struct {
  PerProcessUserTimeLimit int64
  PerJobUserTimeLimit int64
  LimitFlags uint32
  MinimumWorkingSetSize uintptr
  MaximumWorkingSetSize uintptr
  ActiveProcessLimit uint32
  Affinity uintptr
  PriorityClass uint32
  SchedulingClass uint32
}
type ioCounters struct {
  ReadOperationCount uint64
  WriteOperationCount uint64
  OtherOperationCount uint64
  ReadTransferCount uint64
  WriteTransferCount uint64
  OtherTransferCount uint64
}
type extendedLimitInfo struct {
  BasicLimitInformation basicLimitInfo
  IoInfo ioCounters
  ProcessMemoryLimit uintptr
  JobMemoryLimit uintptr
  PeakProcessMemoryUsed uintptr
  PeakJobMemoryUsed uintptr
}

type session struct {
  in *os.File
  out *os.File
  pseudo uintptr
  process syscall.Handle
  job syscall.Handle
  credits chan struct{}
  done chan struct{}
  once sync.Once
}

func winCall(proc *syscall.LazyProc, args ...uintptr) (uintptr, error) {
  r, _, e := proc.Call(args...)
  if r == 0 {
    if e != nil && e != syscall.Errno(0) { return r,e }
    return r,errors.New(proc.Name+": Windows API failure")
  }
  return r,nil
}
func coord(cols,rows int) uintptr {
  return uintptr(uint32(uint16(cols)) | uint32(uint16(rows))<<16)
}

func shellCommand(profile string) (string,string,error) {
  win := os.Getenv("SystemRoot")
  if win == "" { win = `C:\Windows` }
  sys32 := filepath.Join(win,"System32")
  switch profile {
  case "powershell":
    return filepath.Join(sys32,"WindowsPowerShell","v1.0","powershell.exe"), "-NoLogo",nil
  case "cmd":
    return filepath.Join(sys32,"cmd.exe"),"",nil
  case "wsl":
    return filepath.Join(sys32,"wsl.exe"),"",nil
  case "pwsh":
    p,err := exec.LookPath("pwsh.exe")
    if err != nil {return "","",fmt.Errorf("PowerShell 7 (pwsh.exe) is not installed or not on PATH")}
    return p,"-NoLogo",nil
  default:
    return "","",fmt.Errorf("unsupported terminal profile")
  }
}

func newSession(profile string,cols,rows int) (s *session,err error) {
  if !validProfile(profile) || !validSize(cols,rows) {return nil,errors.New("invalid profile or terminal size")}
  exe,args,err := shellCommand(profile)
  if err != nil {return nil,err}
  if _,err=os.Stat(exe);err!=nil{return nil,fmt.Errorf("profile executable unavailable: %w",err)}

  var inRead,inWrite,outRead,outWrite syscall.Handle
  stage("create input pipe")
  if err=syscall.CreatePipe(&inRead,&inWrite,nil,0);err!=nil{return nil,err}
  defer syscall.CloseHandle(inRead)
  if err=syscall.CreatePipe(&outRead,&outWrite,nil,0);err!=nil{syscall.CloseHandle(inWrite);return nil,err}
  defer syscall.CloseHandle(outWrite)

  // Until successfully transferred to the session, these belong to this scope.
  success := false
  var pseudo uintptr
  var process syscall.Handle
  var job syscall.Handle
  defer func(){
    if !success {
      if job!=0 {syscall.CloseHandle(job)}
      if process!=0 {syscall.TerminateProcess(process,1);syscall.CloseHandle(process)}
      if pseudo!=0 {closePseudo.Call(pseudo)}
      syscall.CloseHandle(inWrite)
      syscall.CloseHandle(outRead)
    }
  }()
  stage("CreatePseudoConsole begin")
  result,_,callErr := createPseudo.Call(coord(cols,rows),uintptr(inRead),uintptr(outWrite),0,uintptr(unsafe.Pointer(&pseudo)))
  stage("CreatePseudoConsole returned")
  if result!=0 {return nil,fmt.Errorf("CreatePseudoConsole HRESULT 0x%x: %v",result,callErr)}

  var length uintptr
  stage("init attributes begin")
  initAttributes.Call(0,1,0,uintptr(unsafe.Pointer(&length)))
  if length==0 || length>1<<20 {return nil,errors.New("could not size Windows process attributes")}
  buf:=make([]byte,length)
  ptr:=uintptr(unsafe.Pointer(&buf[0]))
  if _,err=winCall(initAttributes,ptr,1,0,uintptr(unsafe.Pointer(&length)));err!=nil{return nil,err}
  defer deleteAttributes.Call(ptr)
  if _,err=winCall(updateAttributes,ptr,0,procThreadAttributePseudoConsole,uintptr(unsafe.Pointer(&pseudo)),unsafe.Sizeof(pseudo),0,0);err!=nil{return nil,err}

  stage("create job begin")
  rawJob,jobErr:=winCall(createJob,0,0)
  if jobErr!=nil{return nil,fmt.Errorf("create kill-on-close job: %w",jobErr)}
  job=syscall.Handle(rawJob)
  limits:=extendedLimitInfo{}
  limits.BasicLimitInformation.LimitFlags=jobObjectLimitKillOnJobClose
  if _,err=winCall(setJobInfo,uintptr(job),jobObjectExtendedLimitInformation,uintptr(unsafe.Pointer(&limits)),unsafe.Sizeof(limits));err!=nil{return nil,fmt.Errorf("configure kill-on-close job: %w",err)}

  si:=startupInfoEx{}
  si.Cb=uint32(unsafe.Sizeof(si))
  si.AttributeList=ptr
  app,err:=syscall.UTF16PtrFromString(exe)
  if err!=nil{return nil,err}
  line:=`"`+exe+`"`
  if args!="" {line+=" "+args}
  cmdLine,err:=syscall.UTF16PtrFromString(line)
  if err!=nil{return nil,err}
  home,_:=os.UserHomeDir()
  var cwd *uint16
  if home!="" {cwd,_=syscall.UTF16PtrFromString(home)}
  pi:=syscall.ProcessInformation{}
  stage("CreateProcess begin")
  err=syscall.CreateProcess(app,cmdLine,nil,nil,false,extendedStartupInfoPresent|createSuspended,nil,cwd,&si.StartupInfo,&pi)
  stage("CreateProcess returned")
  runtime.KeepAlive(buf)
  if err!=nil{return nil,fmt.Errorf("create terminal process: %w",err)}
  process=pi.Process
  defer syscall.CloseHandle(pi.Thread)
  stage("assign job begin")
  if _,err=winCall(assignJob,uintptr(job),uintptr(process));err!=nil{return nil,fmt.Errorf("assign terminal process to cleanup job: %w",err)}
  stage("assign job returned")
  if r,_,e:=resumeThread.Call(uintptr(pi.Thread));r==0xffffffff{return nil,fmt.Errorf("resume terminal process: %w",e)}

  s=&session{
    in:os.NewFile(uintptr(inWrite),"conpty-input"),
    out:os.NewFile(uintptr(outRead),"conpty-output"),
    pseudo:pseudo, process:process,job:job,
    credits:make(chan struct{},8),done:make(chan struct{}),
  }
  for i:=0;i<cap(s.credits);i++ {s.credits<-struct{}{}}
  success=true
  stage("newSession ready")
  return s,nil
}

func (s *session) close() {
  s.once.Do(func(){
    close(s.done)
    // Kill-on-close job is the primary child-tree termination mechanism.
    if s.job!=0 {syscall.CloseHandle(s.job)}
    if s.in!=nil {s.in.Close()}
    if s.out!=nil {s.out.Close()}
    if s.pseudo!=0 {closePseudo.Call(s.pseudo)}
    if s.process!=0 {syscall.CloseHandle(s.process)}
  })
}
func (s *session) resize(cols,rows int) error {
  if !validSize(cols,rows) {return errors.New("terminal size out of range")}
  r,_,e:=resizePseudo.Call(s.pseudo,coord(cols,rows))
  if r!=0 {return fmt.Errorf("ResizePseudoConsole HRESULT 0x%x: %v",r,e)}
  return nil
}
func (s *session) acknowledge() {
  select {case s.credits<-struct{}{}: default:}
}
func (s *session) streamOutput(w *frameWriter) {
  stage("output pump started")
  // One 4 KiB frame per renderer credit. No unbounded browser output queue.
  buf:=make([]byte,4096)
  for {
    select {case <-s.done: return;case <-s.credits:}
    n,err:=s.out.Read(buf)
    if n>0 {stage(fmt.Sprintf("conpty output %d bytes",n))}
    if n>0 {
      if e:=w.send(response{Type:"data",Data:base64.StdEncoding.EncodeToString(buf[:n])});e!=nil{return}
    } else {s.acknowledge()}
    if err!=nil{return}
  }
}
func (s *session) waitExit(w *frameWriter) {
  if _,err:=syscall.WaitForSingleObject(s.process,infiniteWait);err!=nil {return}
  var code uint32
  if syscall.GetExitCodeProcess(s.process,&code)==nil {
    _=w.send(response{Type:"exit",Code:int64(code)})
  }
}

func main() {
  if runtime.GOOS!="windows" {return}
  stage("host started")
  writer:=&frameWriter{writer:os.Stdout}
  var s *session
  defer func(){if s!=nil{s.close()}}()
  for {
    msg,err:=readFrame(os.Stdin)
    if err!=nil {
      if err!=io.EOF {_=writer.send(response{Type:"error",Message:"Invalid or closed native protocol connection"})}
      return
    }
    stage("request "+msg.Type)
    if s==nil && msg.Type!="start" {
      _=writer.send(response{Type:"error",Message:"Start a profile first"})
      return
    }
    switch msg.Type {
    case "start":
      if s!=nil {
        _=writer.send(response{Type:"error",Message:"One session per terminal tab"})
        return
      }
      s,err=newSession(msg.Profile,msg.Cols,msg.Rows)
      if err!=nil {
        _=writer.send(response{Type:"error",Message:err.Error()})
        return
      }
      stage("sending started")
      if writer.send(response{Type:"started"})!=nil {return}
      go s.streamOutput(writer)
      go s.waitExit(writer)
    case "input":
      if len(msg.Data)>8192 { _=writer.send(response{Type:"error",Message:"Input chunk exceeds 8 KiB"});return }
      if strings.ContainsRune(msg.Data,0) { _=writer.send(response{Type:"error",Message:"NUL input is not supported"});return}
      if _,err=io.WriteString(s.in,msg.Data);err!=nil{_ =writer.send(response{Type:"error",Message:"Terminal input pipe closed"});return}
    case "resize":
      if err=s.resize(msg.Cols,msg.Rows);err!=nil {_=writer.send(response{Type:"error",Message:err.Error()})}
    case "ack":
      s.acknowledge()
    case "close":
      return
    default:
      _=writer.send(response{Type:"error",Message:"Unsupported native message type"})
      return
    }
  }
}
