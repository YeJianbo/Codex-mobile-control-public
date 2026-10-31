using System;
using System.Runtime.InteropServices;
using System.Text;
class HiddenConsoleLauncher {
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct STARTUPINFO {
  public int cb; public string reserved,desktop,title; public int x,y,xSize,ySize,xCountChars,yCountChars,fillAttribute; public uint flags; public short showWindow,reserved2; public IntPtr reservedPtr,stdin,stdout,stderr;
 }
 [StructLayout(LayoutKind.Sequential)] struct PROCESS_INFORMATION { public IntPtr process,thread; public uint pid,tid; }
 [StructLayout(LayoutKind.Sequential)] struct BASIC_LIMIT { public long processTime,jobTime; public uint flags; public UIntPtr minWorkingSet,maxWorkingSet; public uint activeProcesses; public UIntPtr affinity; public uint priority,scheduling; }
 [StructLayout(LayoutKind.Sequential)] struct IO_COUNTERS { public ulong readOps,writeOps,otherOps,readBytes,writeBytes,otherBytes; }
 [StructLayout(LayoutKind.Sequential)] struct EXTENDED_LIMIT { public BASIC_LIMIT basic; public IO_COUNTERS io; public UIntPtr processMemory,jobMemory,peakProcessMemory,peakJobMemory; }
 [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)] static extern bool CreateProcess(string application,StringBuilder command,IntPtr processAttributes,IntPtr threadAttributes,bool inherit,uint flags,IntPtr environment,string directory,ref STARTUPINFO startup,out PROCESS_INFORMATION result);
 [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr GetStdHandle(int id);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetHandleInformation(IntPtr handle,uint mask,uint flags);
 [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle,uint milliseconds);
 [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr handle,out uint code);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
 [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr attributes,string name);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int type,ref EXTENDED_LIMIT info,uint length);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
 [DllImport("kernel32.dll",SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
 [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr process,uint code);
 static string Quote(string arg) {
  var b=new StringBuilder("\"");int slashes=0;
  foreach(char c in arg){if(c=='\\'){slashes++;continue;} if(c=='\"'){b.Append('\\',slashes*2+1);b.Append(c);slashes=0;continue;} b.Append('\\',slashes);slashes=0;b.Append(c);}
  b.Append('\\',slashes*2);b.Append('"');return b.ToString();
 }
 static int Main(string[] args) {
  if(args.Length==0){Console.Error.WriteLine("Missing executable");return 2;}
  IntPtr job=CreateJobObject(IntPtr.Zero,null);
  var limits=new EXTENDED_LIMIT();limits.basic.flags=0x2000;
  if(job==IntPtr.Zero||!SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(typeof(EXTENDED_LIMIT)))){Console.Error.WriteLine("Cannot create process job: "+Marshal.GetLastWin32Error());if(job!=IntPtr.Zero)CloseHandle(job);return 1;}
  var si=new STARTUPINFO();si.cb=Marshal.SizeOf(typeof(STARTUPINFO));si.flags=0x101;si.showWindow=0;
  si.stdin=GetStdHandle(-10);si.stdout=GetStdHandle(-11);si.stderr=GetStdHandle(-12);
  foreach(var h in new[]{si.stdin,si.stdout,si.stderr})if(h!=IntPtr.Zero&&h!=new IntPtr(-1))SetHandleInformation(h,1,1);
  var command=new StringBuilder();foreach(var arg in args){if(command.Length>0)command.Append(' ');command.Append(Quote(arg));}
  PROCESS_INFORMATION pi;
  if(!CreateProcess(args[0],command,IntPtr.Zero,IntPtr.Zero,true,0x14,IntPtr.Zero,null,ref si,out pi)){Console.Error.WriteLine("CreateProcess failed: "+Marshal.GetLastWin32Error());CloseHandle(job);return 1;}
  if(!AssignProcessToJobObject(job,pi.process)||ResumeThread(pi.thread)==0xffffffff){Console.Error.WriteLine("Cannot start process job: "+Marshal.GetLastWin32Error());TerminateProcess(pi.process,1);CloseHandle(pi.thread);CloseHandle(pi.process);CloseHandle(job);return 1;}
  CloseHandle(pi.thread);WaitForSingleObject(pi.process,0xffffffff);uint code;GetExitCodeProcess(pi.process,out code);CloseHandle(pi.process);CloseHandle(job);return unchecked((int)code);
 }
}
